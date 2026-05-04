const Qexecution = require("./query");

exports.processIndustryEmissions = async (req, res) => {
  try {
    const { industry_id } = req.params;

    if (!industry_id) {
      return res.status(400).json({
        status: "fail",
        message: "industry_id required"
      });
    }

    /* =========================
       1. INDUSTRY DATA
    ========================= */
    const industryResult = await Qexecution.queryExecute(
      `SELECT sector, monthly_production_tons, area_sqft
       FROM industries
       WHERE industry_id = ?`,
      [industry_id]
    );

    const industry = (industryResult.rows || industryResult || [])[0];

    if (!industry) {
      return res.status(404).json({
        status: "fail",
        message: "Industry not found"
      });
    }

    const { sector, monthly_production_tons, area_sqft } = industry;

    const productTons = Number(monthly_production_tons);

    /* =========================
       2. CHECK IF MONTH ALREADY PROCESSED
    ========================= */
    const alreadyProcessed = await Qexecution.queryExecute(
      `SELECT industry_id
       FROM industry_monthly_data
       WHERE industry_id = ?
       AND month = DATE_FORMAT(CURDATE(), '%Y-%m-01')
       LIMIT 1`,
      [industry_id]
    );

    if ((alreadyProcessed.rows || alreadyProcessed || []).length > 0) {
      return res.status(200).json({
        status: "success",
        message: "Month already processed. Duplicate cron skipped."
      });
    }

    /* =========================
       3. CURRENT MONTH EMISSIONS
    ========================= */
    const currentRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_emitted),0) AS emitted
       FROM emission_logs
       WHERE industry_id = ?
       AND MONTH(log_date) = MONTH(CURDATE())
       AND YEAR(log_date) = YEAR(CURDATE())`,
      [industry_id]
    );

    const totalCO2Emitted = Number(
      (currentRes.rows || currentRes || [])[0]?.emitted || 0
    );

    /* =========================
       4. THRESHOLDS
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
       5. MONTHLY PENALTY
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

    const tonsToOffsetProd = excessProdIntensity * productTons;
    const tonsToOffsetArea = excessAreaIntensity * area_sqft;

    const monthlyPenalty = Math.max(
      tonsToOffsetProd,
      tonsToOffsetArea
    );

    /* =========================
       6. STORE MONTHLY SNAPSHOT
    ========================= */
    await Qexecution.queryExecute(
      `INSERT INTO industry_monthly_data
       (industry_id, month, penalty, carbon_dioxide_emitted)
       VALUES (?, DATE_FORMAT(CURDATE(), '%Y-%m-01'), ?, ?)`,
      [industry_id, monthlyPenalty, totalCO2Emitted]
    );

    /* =========================
       7. UPDATE TOTAL PENALTY
    ========================= */
    const penaltyRes = await Qexecution.queryExecute(
      `SELECT penalty
       FROM industry_penalty
       WHERE industry_id = ?`,
      [industry_id]
    );

    const existingPenalty = Number(
      (penaltyRes.rows || penaltyRes || [])[0]?.penalty || 0
    );

    const newPenalty = existingPenalty + monthlyPenalty;

    if ((penaltyRes.rows || penaltyRes || []).length > 0) {
      await Qexecution.queryExecute(
        `UPDATE industry_penalty
         SET penalty = ?
         WHERE industry_id = ?`,
        [newPenalty, industry_id]
      );
    } else {
      await Qexecution.queryExecute(
        `INSERT INTO industry_penalty
         (industry_id, penalty)
         VALUES (?, ?)`,
        [industry_id, monthlyPenalty]
      );
    }

    return res.status(200).json({
      status: "success",
      message: "Cron job executed successfully"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "fail",
      message: "Processing failed"
    });
  }
};

exports.getIndustryEmissionDetails = async (req, res) => {
  try {
    const { industry_id } = req.params;

    if (!industry_id) {
      return res.status(400).json({
        status: "fail",
        message: "industry_id required"
      });
    }

    /* =========================
       1. INDUSTRY DATA
    ========================= */
    const industryResult = await Qexecution.queryExecute(
      `SELECT sector, monthly_production_tons, area_sqft
       FROM industries
       WHERE industry_id = ?`,
      [industry_id]
    );

    // console.log(industryResult)

    const industry = (industryResult.rows || industryResult || [])[0];

    if (!industry) {
      return res.status(404).json({
        status: "fail",
        message: "Industry not found"
      });
    }

    const { sector, monthly_production_tons, area_sqft } = industry;
    const productTons = Number(monthly_production_tons);

    /* =========================
       2. CURRENT MONTH EMISSION
    ========================= */
    const currentRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_emitted),0) AS emitted
      FROM emission_logs
      WHERE industry_id = ?
      AND MONTH(log_date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
      AND YEAR(log_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))`,
      [industry_id]
    );

    const totalCO2Emitted = Number(
      (currentRes.rows || currentRes || [])[0]?.emitted || 0
    );

    const currentResco2 = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_emitted),0) AS emitted
      FROM emission_logs
      WHERE industry_id = ?
      AND MONTH(log_date) = MONTH(CURDATE())
      AND YEAR(log_date) = YEAR(CURDATE())`,
      [industry_id]
    );

    const totalCO2Emittedthismonth = Number(
      (currentResco2.rows || currentResco2 || [])[0]?.emitted || 0
    );

    /* =========================
       3. TOTAL PENALTY (TABLE 1)
    ========================= */
    const penaltyRes = await Qexecution.queryExecute(
      `SELECT COALESCE(penalty,0) AS penalty
       FROM industry_penalty
       WHERE industry_id = ?`,
      [industry_id]
    );

    const totalPenalty = Number(
      (penaltyRes.rows || penaltyRes || [])[0]?.penalty || 0
    );

    /* =========================
       4. THRESHOLDS
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
       5. MONTHLY PENALTY
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

    const tonsToOffsetProd = excessProdIntensity * productTons;
    const tonsToOffsetArea = excessAreaIntensity * area_sqft;

    const monthlyPenalty = Math.max(
      tonsToOffsetProd,
      tonsToOffsetArea
    );

    /* =========================
       6. CREDITS REQUIRED
    ========================= */
    const creditsRequired = Math.ceil(totalPenalty / 10);

    productionLimit = threshold.prod * productTons;
    areaLimit = threshold.area * area_sqft;
    effectiveLimit = Math.min(productionLimit, areaLimit);


    /* =========================
       7. RESPONSE
    ========================= */
    return res.status(200).json({
      industryID: sector,

      summary: {
        current_month_emission: totalCO2Emittedthismonth,
        previous_pending_penalty: totalPenalty,
        // previous_month_penalty: Number(monthlyPenalty.toFixed(2)), // correct this to give last months penalty
        // total_emission: Number(totalPenalty.toFixed(2)),
        total_credits_required: creditsRequired,
        alert:
          totalPenalty > 0
            ? "⚠️ Previous emissions not offset!"
            : null
      },

      inputData: {
        totalCO2Emittedthismonth,
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

        totalPenaltyTons: Number(totalPenalty.toFixed(2)),
        limit: effectiveLimit
      },

      creditsRequired
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "fail",
      message: "Failed to fetch details"
    });
  }
};

exports.redeemCarbonCredits = async (req, res) => {
  try {
    const { order_id, industry_id } = req.params;

    if (!order_id) {
      return res.status(400).json({
        status: "fail",
        message: "order_id required"
      });
    }

    if (!industry_id) {
      return res.status(400).json({
        status: "fail",
        message: "industry_id required"
      });
    }

    /* =========================
       1. GET MARKETPLACE ORDER
    ========================= */
    const orderRes = await Qexecution.queryExecute(
      `SELECT * FROM marketplace WHERE order_id = ?`,
      [order_id]
    );

    const order = (orderRes.rows || orderRes || [])[0];

    if (!order) {
      return res.status(404).json({
        status: "fail",
        message: "Marketplace order not found"
      });
    }

    const { owner_id, user_id, amount } = order;

    const penaltyReduction = Number(amount) * 10;

    /* =========================
       2. GET INDUSTRY PENALTY (FROM PARAMS)
    ========================= */
    const penaltyRes = await Qexecution.queryExecute(
      `SELECT penalty FROM industry_penalty WHERE industry_id = ?`,
      [industry_id]
    );

    const penaltyRow = (penaltyRes.rows || penaltyRes || [])[0];

    if (!penaltyRow) {
      return res.status(404).json({
        status: "fail",
        message: "Industry penalty record not found"
      });
    }

    const currentPenalty = Number(penaltyRow.penalty || 0);

    if (currentPenalty < penaltyReduction) {
      return res.status(400).json({
        status: "fail",
        message: "Insufficient industry penalty balance"
      });
    }

    const newPenalty = currentPenalty - penaltyReduction;

    /* =========================
       3. UPDATE INDUSTRY PENALTY
    ========================= */
    await Qexecution.queryExecute(
      `UPDATE industry_penalty
       SET penalty = ?
       WHERE industry_id = ?`,
      [newPenalty, industry_id]
    );

    /* =========================
       4. DETERMINE WALLET TYPE
    ========================= */
    let table, idField, idValue;

    if (owner_id) {
      table = "LandownerOffset";
      idField = "owner_id";
      idValue = owner_id;
    } else if (user_id) {
      table = "NormalUserOffset";
      idField = "user_id";
      idValue = user_id;
    } else {
      return res.status(400).json({
        status: "fail",
        message: "Invalid marketplace record"
      });
    }

    /* =========================
       5. GET WALLET
    ========================= */
    const walletRes = await Qexecution.queryExecute(
      `SELECT total_offset FROM ${table} WHERE ${idField} = ?`,
      [idValue]
    );

    const wallet = (walletRes.rows || walletRes || [])[0];

    if (!wallet) {
      return res.status(404).json({
        status: "fail",
        message: "Wallet not found"
      });
    }

    const currentOffset = Number(wallet.total_offset);



    if (currentOffset < amount) {
      return res.status(400).json({
        status: "fail",
        message: "Insufficient wallet balance"
      });
    }

    const newOffset = currentOffset - amount;

    /* =========================
       6. UPDATE WALLET
    ========================= */
    await Qexecution.queryExecute(
      `UPDATE ${table}
       SET total_offset = ?
       WHERE ${idField} = ?`,
      [newOffset, idValue]
    );

    /* =========================
       7. DELETE MARKETPLACE ENTRY
    ========================= */
    await Qexecution.queryExecute(
      `DELETE FROM marketplace WHERE order_id = ?`,
      [order_id]
    );

    return res.status(200).json({
      status: "success",
      message: "Carbon credits redeemed successfully",
      industry_id,
      penalty_deducted: penaltyReduction,
      wallet_deducted: amount,
      remaining_penalty: newPenalty,
      remaining_wallet: newOffset
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "fail",
      message: "Redemption failed"
    });
  }
};

exports.processLandownerEmissions = async (req, res) => {
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
        message: "No linked industry found"
      });
    }

    const {
      industry_id,
      sector,
      monthly_production_tons,
      area_sqft
    } = industry;

    const productTons = Number(monthly_production_tons);

    /* =========================
       2. PREVENT DOUBLE MONTH PROCESSING
    ========================= */
    const alreadyProcessed = await Qexecution.queryExecute(
      `SELECT industry_id
       FROM industry_monthly_data
       WHERE industry_id = ?
       AND month = DATE_FORMAT(CURDATE(), '%Y-%m-01')
       LIMIT 1`,
      [industry_id]
    );

    if ((alreadyProcessed.rows || alreadyProcessed || []).length > 0) {
      return res.status(200).json({
        status: "success",
        message: "Month already processed. Duplicate skipped."
      });
    }

    /* =========================
       3. CURRENT MONTH EMISSION
    ========================= */
    const currentRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_emitted),0) AS emitted
       FROM emission_logs
       WHERE industry_id = ?
       AND MONTH(log_date)=MONTH(CURDATE())
       AND YEAR(log_date)=YEAR(CURDATE())`,
      [industry_id]
    );

    const totalCO2Emitted = Number(
      (currentRes.rows || currentRes || [])[0]?.emitted || 0
    );

    /* =========================
       4. VERIFIED OFFSET
    ========================= */
    const projectRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_saved),0) AS total_saved
       FROM projects
       WHERE owner_id = ?
       AND verification_status = 'verified'`,
      [owner_id]
    );

    const totalOffset = Number(
      (projectRes.rows || projectRes || [])[0]?.total_saved || 0
    );

    /* =========================
       5. THRESHOLDS
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

    const threshold = BENCHMARKS[sector] || BENCHMARKS.Other;

    /* =========================
       6. PENALTY CALCULATION
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

    const tonsToOffsetProd = excessProdIntensity * productTons;
    const tonsToOffsetArea = excessAreaIntensity * area_sqft;

    const monthlyPenalty = Math.max(
      tonsToOffsetProd,
      tonsToOffsetArea
    );

    /* =========================
       7. APPLY OFFSET
    ========================= */
    const netPenalty = monthlyPenalty - totalOffset;

    let message = "";
    let creditsAvailable = 0;

    if (netPenalty > 0) {
      message = "Penalty should be applied";
    } else {
      message = "Credits can be sold";
      creditsAvailable = Math.abs(netPenalty);
    }

    /* =========================
       8. STORE MONTHLY SNAPSHOT
    ========================= */
    await Qexecution.queryExecute(
      `INSERT INTO industry_monthly_data
       (industry_id, month, penalty, carbon_dioxide_emitted)
       VALUES (?, DATE_FORMAT(CURDATE(), '%Y-%m-01'), ?, ?)`,
      [
        industry_id,
        Math.max(netPenalty, 0),
        totalCO2Emitted
      ]
    );

    /* =========================
       9. UPDATE MASTER PENALTY
    ========================= */
    const penaltyRes = await Qexecution.queryExecute(
      `SELECT penalty
       FROM industry_penalty
       WHERE industry_id = ?`,
      [industry_id]
    );

    const existingPenalty = Number(
      (penaltyRes.rows || penaltyRes || [])[0]?.penalty || 0
    );

    const newPenalty =
      existingPenalty + Math.max(netPenalty, 0);

    if ((penaltyRes.rows || penaltyRes || []).length > 0) {
      await Qexecution.queryExecute(
        `UPDATE industry_penalty
         SET penalty = ?
         WHERE industry_id = ?`,
        [newPenalty, industry_id]
      );
    } else {
      await Qexecution.queryExecute(
        `INSERT INTO industry_penalty
         (industry_id, penalty)
         VALUES (?, ?)`,
        [industry_id, Math.max(netPenalty, 0)]
      );
    }

    /* =========================
       10. RESPONSE
    ========================= */
    return res.status(200).json({
      owner_id,
      industry_id,
      sector,

      summary: {
        current_month_emission: totalCO2Emitted,
        current_month_penalty: Number(monthlyPenalty.toFixed(2)),
        total_offset: Number(totalOffset.toFixed(2)),
        net_penalty: Number(
          Math.max(netPenalty, 0).toFixed(2)
        ),
        sellable_credits: Number(
          creditsAvailable.toFixed(2)
        ),
        message
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "fail",
      message: "Processing failed"
    });
  }
};

exports.getLandownerEmissionDetails = async (req, res) => {
  try {
    const { owner_id } = req.params;

    if (!owner_id) {
      return res.status(400).json({
        status: "fail",
        message: "owner_id required"
      });
    }

    /* =========================
       1. INDUSTRY VIA OWNER
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
        message: "Industry not found for owner"
      });
    }

    const {
      industry_id,
      sector,
      monthly_production_tons,
      area_sqft
    } = industry;

    const productTons = Number(monthly_production_tons);

    /* =========================
       2. LAST MONTH EMISSIONS (FOR CALCULATION)
    ========================= */
    const lastMonthRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_emitted),0) AS emitted
       FROM emission_logs
       WHERE industry_id = ?
       AND MONTH(log_date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
       AND YEAR(log_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))`,
      [industry_id]
    );

    const lastMonthEmitted = Number(
      (lastMonthRes.rows || lastMonthRes || [])[0]?.emitted || 0
    );

    /* =========================
       3. CURRENT MONTH EMISSIONS (REPORT ONLY)
    ========================= */
    const currentMonthRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_emitted),0) AS emitted
       FROM emission_logs
       WHERE industry_id = ?
       AND MONTH(log_date) = MONTH(CURDATE())
       AND YEAR(log_date) = YEAR(CURDATE())`,
      [industry_id]
    );

    const currentMonthEmitted = Number(
      (currentMonthRes.rows || currentMonthRes || [])[0]?.emitted || 0
    );

    /* =========================
       4. OFFSET (PROJECTS)
    ========================= */
    const offsetRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(co2_saved),0) AS total_saved
       FROM projects
       WHERE owner_id = ?
       AND verification_status = 'verified'`,
      [owner_id]
    );

    const totalOffset = Number(
      (offsetRes.rows || offsetRes || [])[0]?.total_saved || 0
    );

    /* =========================
       5. TOTAL PENALTY (STORED)
    ========================= */
    const penaltyRes = await Qexecution.queryExecute(
      `SELECT COALESCE(penalty,0) AS penalty
       FROM industry_penalty
       WHERE industry_id = ?`,
      [industry_id]
    );

    const totalPenalty = Number(
      (penaltyRes.rows || penaltyRes || [])[0]?.penalty || 0
    );

    /* =========================
       6. THRESHOLDS
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

    const threshold = BENCHMARKS[sector] || BENCHMARKS.Other;

    /* =========================
       7. PENALTY (BASED ON LAST MONTH ONLY)
    ========================= */
    const actualProdIntensity =
      productTons > 0 ? lastMonthEmitted / productTons : 0;

    const actualAreaIntensity =
      area_sqft > 0 ? lastMonthEmitted / area_sqft : 0;

    const excessProdIntensity = Math.max(
      0,
      actualProdIntensity - threshold.prod
    );

    const excessAreaIntensity = Math.max(
      0,
      actualAreaIntensity - threshold.area
    );

    const tonsToOffsetProd =
      excessProdIntensity * productTons;

    const tonsToOffsetArea =
      excessAreaIntensity * area_sqft;

    const lastMonthPenalty = Math.max(
      tonsToOffsetProd,
      tonsToOffsetArea
    );

    /* =========================
       8. FINAL NET
    ========================= */
    const netPenalty = totalPenalty - totalOffset;

    const creditsRequired = Math.ceil(Math.max(netPenalty, 0) / 10);

    productionLimit = threshold.prod * productTons;
    areaLimit = threshold.area * area_sqft;
    effectiveLimit = Math.min(productionLimit, areaLimit);

    /* =========================
       9. RESPONSE
    ========================= */
    return res.status(200).json({
      industryID: sector,

      summary: {
        current_month_emission: currentMonthEmitted,
        previous_month_emission: lastMonthEmitted,
        previous_pending_penalty: totalPenalty,
        net_penalty: netPenalty, // the value that needs to be offset if positive and needs to buy tokens if negative
        total_credits_required: creditsRequired,

        alert:
          totalPenalty > 0
            ? "⚠️ Previous emissions not offset!"
            : null
      },

      inputData: {
        current_month_emission: currentMonthEmitted,
        last_month_emission: lastMonthEmitted,
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

        totalPenaltyTons: Number(totalPenalty.toFixed(2)),

        // correct definition of limit
        limit: effectiveLimit
      },

      creditsRequired
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "fail",
      message: "Failed to fetch details"
    });
  }
};
//sale
exports.applyLandownerOffset = async (req, res) => {
  try {
    const { owner_id } = req.params;

    if (!owner_id) {
      return res.status(400).json({
        status: "fail",
        message: "owner_id required"
      });
    }

    /* =========================
       1. GET INDUSTRY
    ========================= */
    const industryResult = await Qexecution.queryExecute(
      `SELECT i.industry_id
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
        message: "Industry not found"
      });
    }

    const { industry_id } = industry;

    /* =========================
       2. GET INDUSTRY PENALTY
    ========================= */
    const penaltyRes = await Qexecution.queryExecute(
      `SELECT penalty
       FROM industry_penalty
       WHERE industry_id = ?`,
      [industry_id]
    );

    const penaltyRow = (penaltyRes.rows || penaltyRes || [])[0];

    const currentPenalty = Number(penaltyRow?.penalty || 0);

    /* =========================
       3. GET LANDOWNER OFFSET
    ========================= */
    const offsetRes = await Qexecution.queryExecute(
      `SELECT total_offset
       FROM LandownerOffset
       WHERE owner_id = ?`,
      [owner_id]
    );

    const offsetRow = (offsetRes.rows || offsetRes || [])[0];

    if (!offsetRow) {
      return res.status(404).json({
        status: "fail",
        message: "Landowner offset record not found"
      });
    }

    const totalOffset = Number(offsetRow.total_offset || 0);

    /* =========================
       4. APPLY OFFSET PROPERLY
    ========================= */
    const creditsUsed = Math.min(currentPenalty, totalOffset);

    const newPenalty = Number(
      (currentPenalty - creditsUsed).toFixed(2)
    );

    const remainingOffset = Number(
      (totalOffset - creditsUsed).toFixed(2)
    );

    /* =========================
       5. UPDATE INDUSTRY PENALTY
    ========================= */
    await Qexecution.queryExecute(
      `UPDATE industry_penalty
       SET penalty = ?
       WHERE industry_id = ?`,
      [newPenalty, industry_id]
    );

    /* =========================
       6. UPDATE LANDOWNER WALLET
    ========================= */
    await Qexecution.queryExecute(
      `UPDATE LandownerOffset
       SET total_offset = ?
       WHERE owner_id = ?`,
      [remainingOffset, owner_id]
    );

    /* =========================
       7. RESPONSE
    ========================= */
    return res.status(200).json({
      status: "success",
      owner_id,
      industry_id,

      previous_penalty: currentPenalty,
      previous_wallet: totalOffset,

      credits_used: creditsUsed,

      new_penalty: newPenalty,
      remaining_wallet: remainingOffset,

      message:
        creditsUsed === 0
          ? "No credits applied"
          : newPenalty > 0
          ? "Penalty partially reduced using landowner credits"
          : "Penalty fully cleared using landowner credits"
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "fail",
      message: "Failed to apply landowner offset"
    });
  }
};
//buy
exports.landownerBuyCredits = async (req, res) => {
  const connection = await Qexecution.getConnection?.(); // if your pool supports transactions

  try {
    const { owner_id } = req.params;
    const { order_id } = req.params;

    if (!owner_id || !order_id) {
      return res.status(400).json({
        status: "fail",
        message: "owner_id and order_id required"
      });
    }

    /* =========================
       1. GET MARKETPLACE ORDER
    ========================= */
    const orderRes = await Qexecution.queryExecute(
      `SELECT * FROM marketplace WHERE order_id = ?`,
      [order_id]
    );

    const order = (orderRes.rows || orderRes || [])[0];

    if (!order) {
      return res.status(404).json({
        status: "fail",
        message: "Marketplace order not found"
      });
    }

    if (order.status !== "open") {
      return res.status(400).json({
        status: "fail",
        message: "Order is not available"
      });
    }

    const { amount, owner_id: seller_owner_id, user_id: seller_user_id } = order;

    const requiredPenaltyReduction = Number(amount) * 10;

    /* =========================
       2. GET BUYER INDUSTRY
    ========================= */
    const industryRes = await Qexecution.queryExecute(
      `SELECT i.industry_id
       FROM project_owners po
       JOIN industries i ON po.registration_id = i.registration_id
       WHERE po.owner_id = ?`,
      [owner_id]
    );

    const industry = (industryRes.rows || industryRes || [])[0];

    if (!industry) {
      return res.status(404).json({
        status: "fail",
        message: "Buyer industry not found"
      });
    }

    const { industry_id } = industry;

    /* =========================
       3. CHECK INDUSTRY PENALTY
    ========================= */
    const penaltyRes = await Qexecution.queryExecute(
      `SELECT penalty FROM industry_penalty WHERE industry_id = ?`,
      [industry_id]
    );

    const penaltyRow = (penaltyRes.rows || penaltyRes || [])[0];

    const currentPenalty = Number(penaltyRow?.penalty || 0);

    if (currentPenalty < requiredPenaltyReduction) {
      return res.status(400).json({
        status: "fail",
        message: "Insufficient penalty balance to redeem credits"
      });
    }

    const newPenalty = currentPenalty - requiredPenaltyReduction;

    /* =========================
       4. DETERMINE SELLER WALLET
    ========================= */
    let sellerTable, sellerField, sellerId;

    if (seller_owner_id) {
      sellerTable = "LandownerOffset";
      sellerField = "owner_id";
      sellerId = seller_owner_id;
    } else if (seller_user_id) {
      sellerTable = "NormalUserOffset";
      sellerField = "user_id";
      sellerId = seller_user_id;
    } else {
      return res.status(400).json({
        status: "fail",
        message: "Invalid seller in marketplace"
      });
    }

    /* =========================
       5. GET SELLER WALLET
    ========================= */
    const sellerWalletRes = await Qexecution.queryExecute(
      `SELECT total_offset FROM ${sellerTable} WHERE ${sellerField} = ?`,
      [sellerId]
    );

    const sellerWallet = (sellerWalletRes.rows || sellerWalletRes || [])[0];

    if (!sellerWallet) {
      return res.status(404).json({
        status: "fail",
        message: "Seller wallet not found"
      });
    }

    const sellerBalance = Number(sellerWallet.total_offset || 0);

    if (sellerBalance < amount) {
      return res.status(400).json({
        status: "fail",
        message: "Seller has insufficient credits"
      });
    }

    const newSellerBalance = sellerBalance - amount;

    /* =========================
       6. GET BUYER WALLET (LANDOWNER)
    ========================= */
    const buyerWalletRes = await Qexecution.queryExecute(
      `SELECT total_offset FROM LandownerOffset WHERE owner_id = ?`,
      [owner_id]
    );

    const buyerWallet = (buyerWalletRes.rows || buyerWalletRes || [])[0];

    if (!buyerWallet) {
      return res.status(404).json({
        status: "fail",
        message: "Buyer wallet not found"
      });
    }

    const buyerBalance = Number(buyerWallet.total_offset || 0);
    const newBuyerBalance = buyerBalance + amount;

    /* =========================
       7. APPLY UPDATES
    ========================= */

    // update industry penalty
    await Qexecution.queryExecute(
      `UPDATE industry_penalty SET penalty = ? WHERE industry_id = ?`,
      [newPenalty, industry_id]
    );

    // update seller wallet
    await Qexecution.queryExecute(
      `UPDATE ${sellerTable} SET total_offset = ? WHERE ${sellerField} = ?`,
      [newSellerBalance, sellerId]
    );

    // update buyer wallet
    await Qexecution.queryExecute(
      `UPDATE LandownerOffset SET total_offset = ? WHERE owner_id = ?`,
      [newBuyerBalance, owner_id]
    );

    // close marketplace order
    await Qexecution.queryExecute(
      `UPDATE marketplace SET status = 'completed' WHERE order_id = ?`,
      [order_id]
    );

    return res.status(200).json({
      status: "success",
      message: "Credits purchased successfully",
      industry_id,
      penalty_before: currentPenalty,
      penalty_after: newPenalty,
      buyer_balance: newBuyerBalance,
      seller_balance: newSellerBalance
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "fail",
      message: "Transaction failed"
    });
  }
};

exports.getOwnerMonthlyHistory = async (req, res) => {
  try {
    const { owner_id } = req.params;

    if (!owner_id) {
      return res.status(400).json({
        status: "fail",
        message: "owner_id required"
      });
    }

    /* =========================
       1. GET INDUSTRY FROM OWNER
    ========================= */
    const industryResult = await Qexecution.queryExecute(
      `SELECT i.industry_id, i.sector
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
        message: "No industry linked to owner"
      });
    }

    const { industry_id } = industry;

    /* =========================
       2. FETCH LAST 20 MONTHS
    ========================= */
    const history = await Qexecution.queryExecute(
      `SELECT 
         month,
         penalty,
         carbon_dioxide_emitted
       FROM industry_monthly_data
       WHERE industry_id = ?
       ORDER BY month DESC
       LIMIT 20`,
      [industry_id]
    );

    return res.status(200).json({
      status: "success",
      owner_id,
      industry_id,
      data: history.rows || history
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "fail",
      message: "Failed to fetch owner history"
    });
  }
};

exports.getIndustryMonthlyHistory = async (req, res) => {
  try {
    const { industry_id } = req.params;

    if (!industry_id) {
      return res.status(400).json({
        status: "fail",
        message: "industry_id required"
      });
    }

    /* =========================
       1. FETCH LAST 20 MONTHS
    ========================= */
    const history = await Qexecution.queryExecute(
      `SELECT 
         month,
         penalty,
         carbon_dioxide_emitted
       FROM industry_monthly_data
       WHERE industry_id = ?
       ORDER BY month DESC
       LIMIT 20`,
      [industry_id]
    );

    return res.status(200).json({
      status: "success",
      industry_id,
      data: history.rows || history
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "fail",
      message: "Failed to fetch industry history"
    });
  }
};

