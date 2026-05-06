const Qexecution = require("./query");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
const ARIMA = require("arima");
const {
  buildTxData,
  enc,
} = require("../Blockchain/contractService");
const { offsetProjectRegistry, greenCreditToken, marketplace } = enc;

require("dotenv").config();
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_API_KEY = process.env.PINATA_SECRET_API_KEY;

async function getEthPkrRate() {
  try {
    const resp = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=pkr",
      { timeout: 5000 }
    );
    return resp.data.ethereum.pkr;
  } catch {
    return 280000; // fallback: ~1 ETH = 280,000 PKR
  }
}

function pkrToWei(pkrAmount, ethPkrRate) {
  return BigInt(Math.round((pkrAmount / ethPkrRate) * 1e18));
}

const TON_PER_TOKEN = 10;

//  Get All Plantations
exports.getPlantation = async (req, res) => {
  try {
    const owner_id = req.params.owner_id || req.query.owner_id;
    if (!owner_id) {
      return res.status(400).json({ status: "fail", message: "owner_id required" });
    }
    const rows = await Qexecution.queryExecute(
      `SELECT * FROM projects WHERE owner_id = ?`,
      [owner_id]
    );
    res.json({ status: "success", plantations: rows });
  } catch (err) {
    res.status(500).json({ status: "fail", message: "Error fetching plantations" });
  }
};

exports.processIndustryEmissions = async (req, res) => {
  try {
    const { owner_id } = req.params;

    if (!owner_id) {
      return res.status(400).json({
        status: "fail",
        message: "owner_id required"
      });
    }

    /* =========================
       1. FETCH INDUSTRY VIA OWNER
    ========================= */
    const industryResult = await Qexecution.queryExecute(
      `SELECT 
         i.industry_id,
         i.sector,
         i.monthly_production_tons,
         i.area_sqft
       FROM project_owners po
       JOIN industries i 
         ON po.registration_id = i.registration_id
       WHERE po.owner_id = ?`,
      [owner_id]
    );

    const industry = (industryResult.rows || industryResult || [])[0];

    if (!industry) {
      return res.status(404).json({
        status: "fail",
        message: "No industry linked to this owner"
      });
    }

    const { industry_id, sector } = industry;

    // SAFE values
    const productTons = Number(industry.monthly_production_tons) || 0;
    const area_sqft = Number(industry.area_sqft) || 0;

    /* =========================
       2. EMISSIONS
    ========================= */
    const currentRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_emitted),0) AS emitted
       FROM emission_logs
       WHERE industry_id = ?
       AND MONTH(log_date) = MONTH(CURDATE())
       AND YEAR(log_date) = YEAR(CURDATE())`,
      [industry_id]
    );

    const totalCO2Emitted = Number(currentRes[0]?.emitted || 0);

    /* =========================
       3. THRESHOLDS
    ========================= */
    const BENCHMARKS = {
      Steel: { prod: 2.2, area: 3.2 / 10.764 },
      Cement: { prod: 1.1, area: 2.4 / 10.764 },
      Textile: { prod: 0.6, area: 1.2 / 10.764 },
      Chemical: { prod: 1.6, area: 2.8 / 10.764 },
      Energy: { prod: 0.8, area: 4.0 / 10.764 },
      Manufacturing: { prod: 1.0, area: 1.8 / 10.764 },
      Other: { prod: 1.2, area: 2.2 / 10.764 }
    };

    const threshold = BENCHMARKS[sector] || BENCHMARKS["Other"];

    /* =========================
       4. SAFE CALCULATIONS
    ========================= */
    const actualProdIntensity =
      productTons > 0 ? totalCO2Emitted / productTons : 0;

    const actualAreaIntensity =
      area_sqft > 0 ? totalCO2Emitted / area_sqft : 0;

    const excessProdIntensity = Math.max(
      0,
      actualProdIntensity - threshold.prod
    );

    const excessAreaIntensity = Math.max(
      0,
      actualAreaIntensity - threshold.area
    );

    const tonsToOffsetProd =
      productTons > 0 ? excessProdIntensity * productTons : 0;

    const tonsToOffsetArea =
      area_sqft > 0 ? excessAreaIntensity * area_sqft : 0;

    let totalPenaltyTons = Math.max(
      tonsToOffsetProd,
      tonsToOffsetArea
    );

    // FINAL SAFETY
    if (!isFinite(totalPenaltyTons)) {
      console.error("Invalid penalty detected", {
        totalCO2Emitted,
        productTons,
        area_sqft
      });
      totalPenaltyTons = 0;
    }

    /* =========================
       5. STORE PENALTY
    ========================= */
    await Qexecution.queryExecute(
      `UPDATE emission_logs
       SET penalty_tons = ?
       WHERE industry_id = ?
       AND MONTH(log_date) = MONTH(CURDATE())
       AND YEAR(log_date) = YEAR(CURDATE())`,
      [totalPenaltyTons, industry_id]
    );

    /* =========================
       6. RAW CREDITS (before offset)
    ========================= */
    const creditsRequired = Math.ceil(totalPenaltyTons / TON_PER_TOKEN);

    /* =========================
       6.5 GREEN PROJECT OFFSET ✅
    ========================= */
    const projectRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_saved), 0) AS total_saved
       FROM projects
       WHERE owner_id = ?
       AND verification_status = 'verified'`,
      [owner_id]
    );

    const totalGreenTons = Number(projectRes[0]?.total_saved || 0);
    const greenCredits = Math.floor(totalGreenTons / TON_PER_TOKEN);

    console.log(totalGreenTons)
    console.log(greenCredits)

    let finalOffsetTons = totalPenaltyTons - totalGreenTons;
    if (finalOffsetTons < 0) finalOffsetTons = 0;

    const finalCreditsRequired = Math.ceil(
      finalOffsetTons / TON_PER_TOKEN
    );

    /* =========================
       6.6 MONTHLY GUARD — prevent duplicate token minting per month
    ========================= */
    const alreadyMintedThisMonth = await Qexecution.queryExecute(
      `SELECT industry_id FROM industry_monthly_data
       WHERE industry_id = ?
       AND month = DATE_FORMAT(CURDATE(), '%Y-%m-01')
       LIMIT 1`,
      [industry_id]
    );
    const monthAlreadyProcessed = (alreadyMintedThisMonth.rows || alreadyMintedThisMonth || []).length > 0;

    /* =========================
       7. TOKEN BALANCE
    ========================= */
    const tokenResult = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(
          CASE 
            WHEN tx_type = 'minted' THEN amount
            WHEN tx_type = 'sold' AND seller_id = ? THEN -amount
            WHEN tx_type = 'sold' AND buyer_id = ? THEN amount
            WHEN tx_type IN ('burnt','retired') THEN -amount
            ELSE 0
          END
      ), 0) AS balance
      FROM token_transactions`,
      [industry_id, industry_id]
    );

    const token_balance = Number(tokenResult[0]?.balance || 0);

    /* =========================
       8. TOKEN EARNING (INDUSTRY)
    ========================= */
    let tokensEarned = 0;

    const allowedProd = threshold.prod * productTons;
    const allowedArea = threshold.area * area_sqft;
    const allowedEmission = Math.min(allowedProd, allowedArea);

    if (totalCO2Emitted < allowedEmission && !monthAlreadyProcessed) {
      const savedTons = allowedEmission - totalCO2Emitted;
      tokensEarned = Math.floor(savedTons / TON_PER_TOKEN);

      if (tokensEarned > 0) {
        const tokenInsert = await Qexecution.queryExecute(
          `INSERT INTO tokens (industry_id, amount)
           VALUES (?, ?)`,
          [industry_id, tokensEarned]
        );

        await Qexecution.queryExecute(
          `INSERT INTO token_transactions
           (token_id, tx_type, amount, buyer_id)
           VALUES (?, 'minted', ?, ?)`,
          [tokenInsert.insertId, tokensEarned, industry_id]
        );
      }
    }

    /* =========================
       9. RESPONSE
    ========================= */
    res.json({
      owner_id,
      industry_id,
      sector,

      inputData: {
        totalCO2Emitted,
        productTons,
        areaSqFt: area_sqft
      },

      results: {
        productionCompliance: {
          allowedIntensity: threshold.prod,
          actualIntensity: Number(actualProdIntensity.toFixed(4)),
          tonsToOffset: Number(tonsToOffsetProd.toFixed(2))
        },

        areaCompliance: {
          allowedIntensity: Number(threshold.area.toFixed(6)),
          actualIntensity: Number(actualAreaIntensity.toFixed(6)),
          tonsToOffset: Number(tonsToOffsetArea.toFixed(2))
        },

        // 🔴 penalty
        totalPenaltyTons: Number(totalPenaltyTons.toFixed(2)),

        // 🟢 green benefit
        greenProject: {
          totalTonsSaved: totalGreenTons,
          creditsEarned: greenCredits
        },

        // 🔥 final
        finalOffset: {
          tons: Number(finalOffsetTons.toFixed(2)),
          creditsRequired: finalCreditsRequired
        },

        limit: totalCO2Emitted - totalPenaltyTons
      },

      creditsRequired,            // raw
      finalCreditsRequired,       // adjusted
      token_balance,
      tokensEarned,

      action:
        finalCreditsRequired > token_balance
          ? "BUY_CREDITS"
          : tokensEarned > 0
          ? "EARNING"
          : "COMPLIANT"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: "Processing failed"
    });
  }
};


// // Submit Emission Log for industrial land usage
// exports.submitEmissionLogs = async (req, res) => {
//   try {
//     const { co2_emitted, co2_limit } = req.body;
//     const { id: industry_id } = req.params;

//     if (!co2_emitted || !co2_limit) {
//       return res.status(400).json({
//         status: "fail",
//         message: "Emission values required"
//       });
//     }

//     const result = await Qexecution.queryExecute(
//       `INSERT INTO emission_logs (industry_id, log_date, co2_emitted, co2_limit) 
//        VALUES (?, CURDATE(), ?, ?)`,
//       [industry_id, co2_emitted, co2_limit]
//     );

//     res.json({ status: "success", emission_log_id: result.insertId });
//   } catch (err) {
//     res.status(500).json({ status: "fail", message: "Error logging emission" });
//   }
// };

// Compare Emissions vs Offsets
exports.compare = async (req, res) => {
  try {
    const emissions = await Qexecution.queryExecute(
      `SELECT SUM(co2_emitted) AS total_emitted FROM emission_logs 
       WHERE industry_id IN (SELECT industry_id FROM industries WHERE registration_id = ?)`,
      [req.user.registration_id]
    );

    const offsets = await Qexecution.queryExecute(
      `SELECT SUM(co2_saved) AS total_offset FROM projects WHERE owner_id = ? AND verification_status='verified'`,
      [req.user.roleId]
    );

    const totalEmitted = Number(emissions?.[0]?.total_emitted || 0);
    const totalOffset = Number(offsets?.[0]?.total_offset || 0);

    res.json({
      status: "success",
      total_emitted: totalEmitted,
      total_offset: totalOffset,
      balance: totalOffset - totalEmitted
    });
  } catch (err) {
    res.status(500).json({ status: "fail", message: "Error fetching summary" });
  }
};

// Record minted tokens (off-chain sync)
exports.mintTokens = async (req, res) => {
  try {
    const { project_id, amount, price_at_mint } = req.body;

    if (!project_id || !amount || !price_at_mint) {
      return res.status(400).json({
        status: "fail",
        message: "Incomplete token data"
      });
    }

    const result = await Qexecution.queryExecute(
      `INSERT INTO tokens (project_id, owner_id, amount, price_at_mint, current_price) 
       VALUES (?, ?, ?, ?, ?)`,
      [project_id, req.user.roleId, amount, price_at_mint, price_at_mint]
    );

    await Qexecution.queryExecute(
      `INSERT INTO token_transactions (token_id, tx_type, amount) VALUES (?, 'minted', ?)`,
      [result.insertId, amount]
    );

    res.json({ status: "success", token_id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "fail", message: "Error minting token" });
  }
};

// Get Tokens Owned by landowner (tokens minted from their verified projects)
exports.getTokens = async (req, res) => {
  try {
    const owner_id = req.params.owner_id || req.query.owner_id;
    if (!owner_id) {
      return res.status(400).json({ status: "fail", message: "owner_id required" });
    }
    const tokens = await Qexecution.queryExecute(
      `SELECT t.*, p.project_name
       FROM tokens t
       LEFT JOIN projects p ON t.project_id = p.project_id
       WHERE t.owner_id = ?`,
      [owner_id]
    );

    res.json({ status: "success", tokens });
  } catch (err) {
    res.status(500).json({ status: "fail", message: "Error fetching tokens" });
  }
};

// View Marketplace Listings (Read-only)
exports.viewMarketplace = async (req, res) => {
  try {
    const listings = await Qexecution.queryExecute(
      `SELECT 
      m.order_id AS listing_id,
      m.price,
      m.status,
      m.amount,

      u.name AS user_name,
      i.industry_name,
      p.project_name

      FROM marketplace m

      LEFT JOIN normal_users u ON m.user_id = u.user_id
      LEFT JOIN industries i ON m.industry_id = i.industry_id
      LEFT JOIN projects p ON m.owner_id = p.owner_id

      WHERE m.status = 'open'`
    );

    res.json({
      status: "success",
      listings
    });
  } catch (err) {
    console.error("Marketplace Error:", err);
    res.status(500).json({
      status: "fail",
      message: "Error fetching marketplace listings"
    });
  }
};

exports.createMarketplaceListing = async (req, res) => {
  try {
    const { owner_id } = req.params;
    const { amount, price } = req.body;

    if (!owner_id || !amount || !price) {
      return res.status(400).json({
        status: "fail",
        message: "owner_id, amount, price required"
      });
    }

    // Compute available balance: minted tokens minus already-listed tokens
    const mintedRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(amount), 0) AS total_minted FROM tokens WHERE owner_id = ?`,
      [owner_id]
    );
    const totalMinted = Number((mintedRes.rows || mintedRes || [])[0]?.total_minted || 0);

    const listedRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(amount), 0) AS total_listed FROM marketplace WHERE owner_id = ? AND status = 'open'`,
      [owner_id]
    );
    const totalListed = Number((listedRes.rows || listedRes || [])[0]?.total_listed || 0);

    const available = totalMinted - totalListed;

    if (Number(amount) > available) {
      return res.status(400).json({
        status: "fail",
        message: `Insufficient credits. You have ${available} credit(s) available to sell.`
      });
    }

    const result = await Qexecution.queryExecute(
      `INSERT INTO marketplace (owner_id, amount, price, status)
       VALUES (?, ?, ?, 'open')`,
      [owner_id, amount, price]
    );

    res.json({
      status: "success",
      listing_id: result.insertId
    });

  } catch (err) {
    res.status(500).json({
      status: "fail",
      message: err.message
    });
  }
};

// ── Blockchain: Save chain_listing_id after createListing tx confirms ─────────
exports.recordChainListing = async (req, res) => {
  try {
    const { order_id, chain_listing_id } = req.body;
    if (order_id === undefined || chain_listing_id === undefined) {
      return res.status(400).json({ status: "fail", message: "order_id and chain_listing_id required" });
    }
    await Qexecution.queryExecute(
      `UPDATE marketplace SET chain_listing_id = ? WHERE order_id = ?`,
      [chain_listing_id, order_id]
    );
    res.json({ status: "success" });
  } catch (err) {
    console.error("recordChainListing error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

exports.upload = multer({ dest: "uploads/" }).single("image");

exports.uploadProjectToIPFS = async (req, res) => {
  try {
    const {
      name, latitude, longitude, description,
      ownerId, project_type,
      co2_saved_override
    } = req.body;

    if (!ownerId) {
      return res.status(401).json({
        status: "fail",
        message: "Unauthorized user"
      });
    }

    if (!req.file || !name || !latitude || !longitude || !description || !project_type) {
      return res.status(400).json({
        status: "fail",
        message: "Missing required fields"
      });
    }

    /* ===============================
       1. FETCH AREA FROM DB (IMPORTANT FIX)
    =============================== */

    const ownerResult = await Qexecution.queryExecute(
      `SELECT green_land 
       FROM project_owners 
       WHERE owner_id = ?`,
      [ownerId]
    );

    const rows = ownerResult.rows || ownerResult || [];

    if (!rows.length) {
      return res.status(404).json({
        status: "fail",
        message: "Project owner not found"
      });
    }

    const area = Number(rows[0].green_land);

    /* ===============================
       CO2 CALCULATION
    =============================== */

    const absorptionRates = {
      forest: 10,
      plantation: 6,
      grassland: 3
    };

    const rate = absorptionRates[project_type.toLowerCase()] || 5;

    const co2_saved = co2_saved_override
      ? Number(co2_saved_override)
      : area * rate;

    /* ===============================
       2. Upload IMAGE
    =============================== */

    const filePath = req.file.path;
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));

    const imageUploadResponse = await axios.post(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      formData,
      {
        maxBodyLength: Infinity,
        headers: {
          ...formData.getHeaders(),
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET_API_KEY,
        },
      }
    );

    const imageCID = imageUploadResponse.data.IpfsHash;
    fs.unlinkSync(filePath);

    /* ===============================
       3. Upload METADATA
    =============================== */

    const metadata = {
      name,
      latitude,
      longitude,
      description,
      imageCID,
      ownerId,
      area,
      project_type,
      co2_saved
    };

    const jsonUploadResponse = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      metadata,
      {
        headers: {
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET_API_KEY,
        },
      }
    );

    const metadataCID = jsonUploadResponse.data.IpfsHash;

    /* ===============================
       4. SAVE IN DB (FIXED)
    =============================== */

    const result = await Qexecution.queryExecute(
      `INSERT INTO projects 
      (project_name, gps_coordinates, image_url, metadata_cid, owner_id, area, project_type, co2_per_unit, co2_saved)
      VALUES (?, POINT(?, ?), ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        parseFloat(latitude),
        parseFloat(longitude),
        imageCID,
        metadataCID,
        ownerId,
        area,
        project_type,
        rate,
        co2_saved
      ]
    );

    /* ===============================
      5. UPSERT LANDOWNER OFFSET
    =============================== */

    await Qexecution.queryExecute(
      `
      INSERT INTO LandownerOffset (owner_id, total_offset)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        total_offset = total_offset + VALUES(total_offset)
      `,
      [ownerId, co2_saved]
    );

    res.status(200).json({
      status: "success",
      message: "Project uploaded successfully",
      project_id: result.insertId,
      metadataCID,
      area,
      co2_saved
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "fail",
      message: error.message
    });
  }
};

exports.landSummary = async (req, res) => {
  try {
    const { owner_id, registration_id } = req.params;

    /* -------- GREEN + INDUSTRIAL LAND -------- */
    const landResult = await Qexecution.queryExecute(
      `SELECT 
         COALESCE(SUM(green_land),0) AS green_land,
         COALESCE(SUM(industry_area),0) AS industry_area,
         COALESCE(SUM(total_area),0) AS total_land
       FROM project_owners
       WHERE owner_id = ?`,
      [owner_id]
    );

    const greenLand = landResult[0]?.green_land || 0;
    const industrialLand = landResult[0]?.industry_area || 0;
    const totalLand = landResult[0]?.total_land || 0;

    /* -------- GREEN OFFSET (FROM PROJECTS) -------- */
    const offsetResult = await Qexecution.queryExecute(
      `SELECT 
         COALESCE(SUM(co2_saved),0) AS total_offset
       FROM projects
       WHERE owner_id = ?`,
      [owner_id]
    );

    const totalOffset = offsetResult[0]?.total_offset || 0;

    /* -------- INDUSTRIAL EMISSIONS -------- */
    const emissionResult = await Qexecution.queryExecute(
      `SELECT 
         COALESCE(SUM(co2_emitted),0) AS total_emitted
       FROM emission_logs
       WHERE industry_id IN (
         SELECT industry_id FROM industries
         WHERE registration_id = ?
       )`,
      [registration_id]
    );

    const totalEmitted = emissionResult[0]?.total_emitted || 0;

    /* -------- BALANCE -------- */
    const netBalance = totalOffset - totalEmitted;

    const tokensRequired = Math.ceil(totalEmitted / TON_PER_TOKEN);
    const tokensAvailable = Math.floor(totalOffset / TON_PER_TOKEN);

    res.json({
      status: "success",
      land: {
        total_land: totalLand,
        green_land: greenLand,
        industry_area: industrialLand
      },
      emissions: {
        total_emitted: totalEmitted
      },
      offset: {
        total_offset: totalOffset
      },
      tokens: {
        required: tokensRequired,
        available: tokensAvailable
      },
      net_balance: netBalance,
      action:
        netBalance < 0
          ? "BUY_CREDITS"
          : netBalance > 0
          ? "SELL_CREDITS"
          : "NO_ACTION"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: err.message
    });
  }
};

// ── Blockchain: Get tx data for createListing(amount, pricePerToken) ─────────
// Important: frontend must first call token.approve(marketplaceAddress, amount)
// then call marketplace.createListing(amount, pricePerToken).
// This endpoint returns BOTH tx payloads in the correct order.
exports.getCreateListingTx = async (req, res) => {
  try {
    const { amount, price_per_token } = req.body;
    if (!amount || !price_per_token) {
      return res.status(400).json({
        status: "fail",
        message: "amount and price_per_token required",
      });
    }

    const marketplaceAddress = await marketplace.getAddress();

    // Convert PKR price to Wei so the contract stores ETH-denominated price
    const ethPkrRate = await getEthPkrRate();
    const pricePerTokenWei = pkrToWei(price_per_token, ethPkrRate);

    // Step 1: approve marketplace to spend tokens (no ETH sent — only gas)
    const approveTxData = await buildTxData(greenCreditToken, "approve", [
      marketplaceAddress,
      BigInt(amount),
    ]);

    // Step 2: create the listing with price in Wei
    const listingTxData = await buildTxData(marketplace, "createListing", [
      BigInt(amount),
      pricePerTokenWei,
    ]);

    res.json({
      status: "success",
      message: "Send approveTx first, then listingTx",
      approveTxData,
      listingTxData,
    });
  } catch (err) {
    console.error("getCreateListingTx error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// ── Blockchain: Get tx data for cancelListing(listingId) ─────────────────────
// Accepts chain_listing_id (the on-chain uint listingId from the ListingCreated event).
exports.getCancelListingTx = async (req, res) => {
  try {
    const { chain_listing_id } = req.body;
    if (chain_listing_id === undefined || chain_listing_id === null) {
      return res.status(400).json({ status: "fail", message: "chain_listing_id required" });
    }
    const txData = await buildTxData(marketplace, "cancelListing", [chain_listing_id]);
    res.json({ status: "success", txData });
  } catch (err) {
    console.error("getCancelListingTx error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// ── Remove stale DB-only listing (no chain_listing_id) ─────────────────────
exports.removeDbListing = async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ status: "fail", message: "order_id required" });
    }
    // Only allow removing rows that have no on-chain ID (stale/unlinked)
    await Qexecution.queryExecute(
      `UPDATE marketplace SET status = 'cancelled' WHERE order_id = ? AND chain_listing_id IS NULL`,
      [order_id]
    );
    res.json({ status: "success" });
  } catch (err) {
    console.error("removeDbListing error:", err.message);
    res.status(500).json({ status: "fail", message: err.message });
  }
};

// ── SARIMA Emission Forecast for Landowner (uses linked industry emission logs) ──
exports.getEmissionForecast = async (req, res) => {
  try {
    const owner_id = req.user?.roleId;

    if (!owner_id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const industryResult = await Qexecution.queryExecute(
      `SELECT i.industry_id
       FROM project_owners po
       JOIN industries i ON po.registration_id = i.registration_id
       WHERE po.owner_id = ?`,
      [owner_id]
    );

    const industry = (industryResult.rows || industryResult || [])[0];
    if (!industry) {
      return res.status(404).json({ message: "No linked industry found" });
    }

    const { industry_id } = industry;

    const result = await Qexecution.queryExecute(
      `SELECT log_date, co2_emitted FROM emission_logs WHERE industry_id = ? ORDER BY log_date ASC`,
      [industry_id]
    );
    const rows = result.rows || result || [];

    if (!Array.isArray(rows) || rows.length < 22) {
      return res.status(400).json({
        message: "Not enough data for forecasting. At least 22 emission records are required."
      });
    }

    const emissionsSeries = rows.map(r => Number(r.co2_emitted));
    const options = { p: 1, d: 1, q: 1, P: 1, D: 1, Q: 1, s: 7, verbose: false };
    const model = new ARIMA(options).train(emissionsSeries);
    const forecastArray = model.predict(7);

    const today = new Date();
    const forecastWithDates = forecastArray[0].map((val, idx) => {
      const forecastDate = new Date(today);
      forecastDate.setDate(today.getDate() + idx + 1);
      return {
        date: forecastDate.toISOString().split("T")[0],
        predicted_co2_emitted: Number(val.toFixed(2))
      };
    });

    res.json(forecastWithDates);
  } catch (err) {
    console.error("landowner getEmissionForecast error:", err.message);
    res.status(500).json({ message: "Forecast generation failed" });
  }
};
