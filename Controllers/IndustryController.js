const Qexecution = require("./query");
const { detectAnomaly } = require("../services/anomalyService");
const { generateExplanation } = require("../services/genaiService");
const { uploadJSONToIPFS } = require("../services/ipfsService");
const ARIMA = require("arima");
const {
  buildTxData,
  enc,
} = require("../Blockchain/contractService");
const { emitterRegistry, greenCreditToken, marketplace } = enc;

// ── Blockchain: Get tx data for registerEmitter() ────────────────────────────
// Frontend calls this to get the tx payload, then signs & sends via MetaMask.
exports.getRegisterEmitterTx = async (req, res) => {
  try {
    const txData = await buildTxData(emitterRegistry, "registerEmitter", []);
    res.json({ status: "success", txData });
  } catch (err) {
    console.error("getRegisterEmitterTx error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// ── Blockchain: Get tx data for offsetEmissions(credits) ─────────────────────
exports.getOffsetEmissionsTx = async (req, res) => {
  try {
    const { credits } = req.body;
    if (!credits) {
      return res.status(400).json({ status: "fail", message: "credits required" });
    }
    const txData = await buildTxData(emitterRegistry, "offsetEmissions", [credits]);
    res.json({ status: "success", txData });
  } catch (err) {
    console.error("getOffsetEmissionsTx error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// ── Blockchain: Get tx data for GreenCreditToken.retire(amount) ──────────────
exports.getRetireCreditsTx = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) {
      return res.status(400).json({ status: "fail", message: "amount required" });
    }
    const txData = await buildTxData(greenCreditToken, "retire", [amount]);
    res.json({ status: "success", txData });
  } catch (err) {
    console.error("getRetireCreditsTx error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// ── Blockchain: Get tx data for emitterRegistry.reportEmissions(tons) ─────────
// Call this AFTER the DB report (/industry/emissions). Pass same co2_emitted value.
exports.getReportEmissionsTx = async (req, res) => {
  try {
    const { tons } = req.body;
    if (!tons) {
      return res.status(400).json({ status: "fail", message: "tons required" });
    }
    const txData = await buildTxData(emitterRegistry, "reportEmissions", [tons]);
    res.json({ status: "success", txData });
  } catch (err) {
    console.error("getReportEmissionsTx error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// ── Blockchain: Get tx data for buyListing(listingId) ────────────────────────
exports.getBuyListingTx = async (req, res) => {
  try {
    const { listing_id } = req.body;
    if (!listing_id) {
      return res.status(400).json({ status: "fail", message: "listing_id required" });
    }
    const txData = await buildTxData(marketplace, "buyListing", [listing_id]);
    res.json({ status: "success", txData });
  } catch (err) {
    console.error("getBuyListingTx error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// Report Emissions (Off-chain record + returns on-chain tx data)
exports.reportEmissions = async (req, res) => {
  try {
    const { co2_emitted, co2_limit } = req.body;


    if (!co2_emitted || !co2_limit) {
      return res.status(400).json({
        status: "fail",
        message: "Emission data incomplete"
      });
    }

    const industryId = req.user.roleId;

    // ----- Create metadata for IPFS -----
    const metadata = {
      industry_id: industryId,
      co2_emitted,
      co2_limit,
      timestamp: new Date().toISOString(),
      data_type: "emission_log"
    };

    // Upload to IPFS
    const ipfsCID = await uploadJSONToIPFS(metadata);

    //  Save emission
    const result = await Qexecution.queryExecute(
      `INSERT INTO emission_logs 
       (industry_id, log_date, co2_emitted, co2_limit, ipfs_cid)
       VALUES (?, CURDATE(), ?, ?, ?)`,
      [industryId, co2_emitted, co2_limit, ipfsCID]
    );

    //  Get recent emissions for model
    const logs = await Qexecution.queryExecute(
      `SELECT co2_emitted 
       FROM emission_logs
       WHERE industry_id = ?
       ORDER BY log_date DESC
       LIMIT 20`,
      [industryId]
    );

    const formattedLogs = Array.isArray(logs) ? [...logs].reverse() : [];

    //  Run anomaly model
    const modelResult = await detectAnomaly(formattedLogs);

    const riskScore = modelResult.risk_score;

    let explanation = null;

    console.log("riskScore", riskScore)

    //  If anomaly risk high
    if (riskScore > 0.25) {

      explanation = await generateExplanation(
        co2_emitted,
        co2_limit,
        riskScore
      );

      await Qexecution.queryExecute(
        `INSERT INTO ai_alerts 
         (industry_id, alert_type, risk_score, message)
         VALUES (?, ?, ?, ?)`,
        [
          req.user.roleId,
          "EMISSION_ANOMALY",
          riskScore,
          explanation
        ]
      );
    }

    // ----- Build on-chain tx data for EmitterRegistry.reportEmissions(tons) -----
    // Frontend should call emitterRegistry.reportEmissions(co2_emitted) with MetaMask
    // after receiving this response.
    const chainTxData = await buildTxData(
      emitterRegistry,
      "reportEmissions",
      [Math.round(Number(co2_emitted))]
    );

    res.json({
      status: "success",
      emission_log_id: result.insertId,
      ipfs_cid: ipfsCID,
      risk_score: riskScore,
      anomaly_detected: riskScore > 0.25,
      explanation,
      // Frontend uses this to submit the matching on-chain transaction
      chainTxData,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: "Error reporting emissions"
    });
  }
};

// Emission Details
exports.getEmissionDetails = async (req, res) => {
  try {
    const industryId = req.user.roleId;

    const history = await Qexecution.queryExecute(
      `SELECT log_date, co2_emitted, co2_limit
       FROM emission_logs
       WHERE industry_id = ?
       ORDER BY log_date DESC`,
      [industryId]
    );

    const emissions = await Qexecution.queryExecute(
      `SELECT SUM(co2_emitted) AS total_emitted
       FROM emission_logs
       WHERE industry_id = ?`,
      [industryId]
    );

    // token_transactions may not exist yet — fall back to 0
    let totalOffset = 0;
    try {
      const offsets = await Qexecution.queryExecute(
        `SELECT SUM(amount) AS total_offset
         FROM token_transactions
         WHERE tx_type IN ('burnt', 'retired')
         AND buyer_industry_id = ?`,
        [industryId]
      );
      totalOffset = Number(offsets?.[0]?.total_offset || 0);
    } catch (_) {
      // table doesn't exist yet — ignore
    }

    const totalEmitted = Number(emissions?.[0]?.total_emitted || 0);

    res.json({
      status: "success",
      summary: {
        total_emitted: totalEmitted,
        total_offset: totalOffset,
        balance: totalOffset - totalEmitted
      },
      history
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: "Error fetching emission dashboard"
    });
  }
};

// View Offset Credits Owned (Read-only)
exports.getOwnedCredits = async (req, res) => {
  try {
    const tokens = await Qexecution.queryExecute(
      `SELECT t.token_id AS id, t.amount, t.current_price, p.project_name
       FROM tokens t
       JOIN projects p ON t.project_id = p.project_id
       WHERE t.owner_user_id = ?`,
      [req.user.roleId]
    );

    res.json({
      status: "success",
      credits: tokens
    });
  } catch (err) {
    res.status(500).json({
      status: "fail",
      message: "Error fetching owned credits"
    });
  }
};

// Marketplace – View Available Listings (Read-only)
exports.viewMarketplace = async (req, res) => {
  try {
    const listings = await Qexecution.queryExecute(
      `SELECT
         m.order_id    AS listing_id,
         m.amount,
         m.price,
         MIN(p.project_name) AS project_name,
         MIN(p.co2_saved)    AS co2_saved,
         NULL                AS location
       FROM marketplace m
       LEFT JOIN projects p ON m.owner_id = p.owner_id
       WHERE m.status = 'open'
       GROUP BY m.order_id, m.amount, m.price`
    );

    res.json({
      status: "success",
      listings
    });
  } catch (err) {
    res.status(500).json({
      status: "fail",
      message: "Error fetching marketplace listings"
    });
  }
};

// Get SARIMA Forecast for an Industry
exports.getEmissionForecast = async (req, res) => {
  // Use authenticated user's industry ID; fall back to URL param for direct calls
  const industryId = req.user?.roleId || req.params.industryId;

  try {
    const SQL = `
      SELECT log_date, co2_emitted
      FROM emission_logs
      WHERE industry_id = ?
      ORDER BY log_date ASC
    `;

    const result = await Qexecution.queryExecute(SQL, [industryId]);
    const rows = result.rows || result || [];

    if (!Array.isArray(rows) || rows.length < 20) {
      return res.status(400).json({
        message: "Not enough data for forecasting"
      });
    }

    // Prepare time series
    const emissionsSeries = rows.map(r => Number(r.co2_emitted));

    // SARIMA config
    const options = {
      p: 1,
      d: 1,
      q: 1,
      P: 1,
      D: 1,
      Q: 1,
      s: 7,
      verbose: false
    };

    // Train model
    const model = new ARIMA(options).train(emissionsSeries);

    // Predict next 7 values
    const forecastArray = model.predict(7); // returns [[val1, val2, ...]]

    // Generate next 7 dates
    const today = new Date();
    const forecastWithDates = forecastArray[0].map((val, idx) => {
      const forecastDate = new Date(today);
      forecastDate.setDate(today.getDate() + idx + 1); // start from tomorrow
      return {
        date: forecastDate.toISOString().split("T")[0],
        predicted_co2_emitted: Number(val.toFixed(2))
      };
    });

    res.json(forecastWithDates);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Forecast generation failed"
    });
  }
};