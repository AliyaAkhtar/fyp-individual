const Tesseract = require("tesseract.js");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const Qexecution = require("./query");
// const { buildTxData, enc } = require("../Blockchain/contractService");
// const { marketplace } = enc;
const { ethers } = require("ethers");
const { buildTxData, enc } = require("../Blockchain/contractService");
const { marketplace, greenCreditToken } = enc;

const path = require("path");

const uploadPath =
  process.env.NODE_ENV === "production"
    ? "/tmp"
    : path.join(__dirname, "uploads");

const upload = multer({
  dest: uploadPath
});

exports.uploadBill = upload.single("bill");
/* =========================================
   OCR + GenAI Electricity Bill Analysis
========================================= */

exports.analyzeElectricityBill = async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!req.file) {
      return res.status(400).json({
        status: "fail",
        message: "Bill image required"
      });
    }

    if (!user_id) {
      return res.status(400).json({
        status: "fail",
        message: "user_id are required"
      });
    }

    /* =========================
   FETCH USER DATA ✅
========================= */
    const userResult = await Qexecution.queryExecute(
      `SELECT house_area, num_people
      FROM normal_users
      WHERE user_id = ?`,
      [user_id]
    );

    const user = (userResult.rows || userResult || [])[0];

    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User not found"
      });
    }

    const house_area = Number(user.house_area) || 0;
    const num_people = Number(user.num_people) || 0;

    const now = new Date();
    const month = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);

    const imagePath = req.file.path;

    /* =========================
       OCR
    ========================= */
    const { data: { text } } = await Tesseract.recognize(imagePath, "eng");
    const cleanText = clean(text);

    /* =========================
       EXTRACT DATA
    ========================= */
    let bill = {
      amountDue: extract(cleanText, [
        /Amount\s*Payable\s*within\s*Due\s*Date\s*([\d,]+)/i,
        /Rs\.?\s*([\d,]{4,})/i
      ]),
      units: extract(cleanText, [
        /(\d{2,4})\s*Units/i
      ]),
      dueDate: extract(cleanText, [
        /Due\s*Date\s*(\d{1,2}[-\w]+\s?\d{4})/i
      ])
    };

    /* =========================
       AI FALLBACK
    ========================= */
    if (!bill.units) {
      const aiData = await interpretBillWithAI(cleanText);
      bill.units = aiData.units_consumed;
      bill.amountDue = bill.amountDue || aiData.amount_due;
      bill.dueDate = bill.dueDate || aiData.due_date;
    }

    const units = Number(bill.units || 0);

    /* =========================
       EFFICIENCY MODEL
    ========================= */
    const CO2_PER_KWH = 0.0004;
    const CREDIT_VALUATION = 10;
    const BASE_KWH_PER_SQFT = 0.2;
    const KWH_PER_PERSON = 120;

    // 1. QUOTA
    const quotaKwh =
      (Number(house_area) * BASE_KWH_PER_SQFT) +
      (Number(num_people) * KWH_PER_PERSON);

    // 2. SAVINGS
    const kwhSaved = Math.max(0, quotaKwh - units);

    // 3. CO2 SAVED
    const co2_saved = Number((kwhSaved * CO2_PER_KWH).toFixed(6));

    // 4. TOKENS (1 token = 10 tons CO2)
    // const tokensToGive = Math.floor(co2_saved / CREDIT_VALUATION);
    const tokensToGive = Number((co2_saved / CREDIT_VALUATION).toFixed(6));
    const eligible_for_credit = tokensToGive > 0 ? 1 : 0;

    fs.unlinkSync(imagePath);


    /* =========================
       SAVE BILL
    ========================= */
    const insertSQL = `
      INSERT INTO electricity_bills 
      (user_id, month, unit_used, co2_released, co2_saved, tokens_earned, eligible_for_credit, admin_approval_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    const result = await Qexecution.queryExecute(insertSQL, [
      user_id,
      month,
      units,
      0,
      co2_saved,
      tokensToGive,        // ✅ NEW FIELD
      eligible_for_credit
    ]);

    const bill_id = result.insertId;

    /* =========================
       TOKEN MINTING
    ========================= */
    let token_id = null;

    if (tokensToGive > 0) {
      const tokenResult = await Qexecution.queryExecute(
        `INSERT INTO tokens 
        (user_id, amount, price_at_mint, current_price)
        VALUES (?, ?, 10, 10)`,
        [user_id, tokensToGive]
      );

      token_id = tokenResult.insertId;

      await Qexecution.queryExecute(
        `INSERT INTO NormalUserOffset (user_id, total_offset)
          VALUES (?, ?)
          ON DUPLICATE KEY UPDATE
          total_offset = total_offset + VALUES(total_offset)`,
        [user_id, co2_saved]
      );

      // await Qexecution.queryExecute(
      //   `INSERT INTO token_transactions
      //   (token_id, tx_type, amount)
      //   VALUES (?, 'minted', ?)`,
      //   [token_id, tokensToGive]
      // );
    }

    /* =========================
       RESPONSE
    ========================= */
    res.json({
      status: "success",
      bill_id,
      extracted_data: {
        units,
        amount_due: bill.amountDue,
        due_date: bill.dueDate
      },
      energy: {
        quota_kwh: Number(quotaKwh.toFixed(2)),
        actual_kwh: units,
        saved_kwh: Number(kwhSaved.toFixed(2))
      },
      carbon: {
        co2_saved,
        conversion: "0.0004 ton per kWh"
      },
      rewards: {
        tokens_earned: tokensToGive,
        note: "1 token = 10 tons CO2 saved"
      },
      eligible_for_credit
    });

  } catch (error) {
    console.error("analyzeElectricityBill error:", error);
    res.status(500).json({
      status: "fail",
      message: "Bill analysis failed"
    });
  }
};

/* =========================================
   Carbon Calculation + Credit Suggestion
========================================= */

exports.calculateCarbonOffset = async (req, res) => {
  try {
    const { bill_id } = req.params;

    if (!bill_id) {
      return res.status(400).json({
        status: "fail",
        message: "bill_id required"
      });
    }

    const result = await Qexecution.queryExecute(
      `SELECT unit_used, co2_saved FROM electricity_bills WHERE bill_id = ?`,
      [bill_id]
    );

    const rows = result.rows || result || [];

    if (!rows.length) {
      return res.status(404).json({
        status: "fail",
        message: "Bill not found"
      });
    }

    const units = Number(rows[0].unit_used);
    const co2_saved = Number(rows[0].co2_saved || 0);

    // CO2 emitted baseline
    const emissionFactor = 0.0004;
    const co2_emitted = units * emissionFactor;

    // Net impact
    const net_co2 = co2_emitted - co2_saved;

    const credits_required = net_co2 > 0
      ? Number(net_co2.toFixed(4))
      : 0;

    // Marketplace suggestions
    let suggestions = [];

    if (credits_required > 0) {
      // const listings = await Qexecution.queryExecute(
      //   `SELECT 
      //     m.order_id AS listing_id,
      //     t.amount,
      //     m.price
      //   FROM marketplace m
      //   JOIN tokens t ON m.token_id = t.token_id
      //   WHERE m.status = 'open'
      //   ORDER BY m.price ASC`
      // );

      const listings = await Qexecution.queryExecute(
        `SELECT 
          m.order_id AS listing_id,
          m.amount,
          m.price
        FROM marketplace m
        WHERE m.status = 'open'
        ORDER BY m.price ASC`
      );

      let remaining = credits_required;

      for (let item of listings) {
        if (remaining <= 0) break;

        const usable = Math.min(item.amount, remaining);

        suggestions.push({
          listing_id: item.listing_id,
          buy_amount: Number(usable.toFixed(4)),
          price_per_token: item.price
        });

        remaining -= usable;
      }
    }

    res.json({
      status: "success",
      data: {
        bill_id,
        units,
        co2_emitted: Number(co2_emitted.toFixed(4)),
        co2_saved,
        net_co2: Number(net_co2.toFixed(4)),
        action: credits_required > 0 ? "BUY" : "NO_NEED",
        credits_required,
        suggestions
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "fail",
      message: "Error calculating offset"
    });
  }
};

/* =========================================
   View Marketplace Listings
========================================= */

exports.viewMarketplace = async (req, res) => {
  try {
    const { user_id } = req.params; // or req.user.user_id if using auth middleware

    if (!user_id) {
      return res.status(400).json({
        status: "fail",
        message: "user_id is required"
      });
    }

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

      WHERE m.status = 'open'
      AND m.user_id = ?`,
      [user_id]
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

exports.createSellOrderIndividual = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { amount, price } = req.body;

    if (!user_id || !amount || !price) {
      return res.status(400).json({
        status: "fail",
        message: "user_id, amount, price required"
      });
    }

    if (amount <= 0 || price <= 0) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid amount or price"
      });
    }

    /* =========================
       1. TOTAL TOKEN BALANCE (FROM TOKENS TABLE ONLY)
    ========================= */
    const balanceResult = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(amount), 0) AS balance
       FROM tokens
       WHERE user_id = ?`,
      [user_id]
    );

    const balanceRows = balanceResult.rows || balanceResult || [];
    const balance = Number(balanceRows[0]?.balance || 0);

    /* =========================
       2. ALREADY LISTED TOKENS
    ========================= */
    const listedResult = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(amount), 0) AS listed
       FROM marketplace
       WHERE user_id = ? AND status = 'open'`,
      [user_id]
    );

    const listedRows = listedResult.rows || listedResult || [];
    const listed = Number(listedRows[0]?.listed || 0);

    /* =========================
       3. AVAILABLE TOKENS
    ========================= */
    const available = balance - listed;

    if (available < amount) {
      return res.status(400).json({
        status: "fail",
        message: `Only ${available} tokens available (already listed: ${listed})`
      });
    }

    /* =========================
       4. CREATE SELL ORDER
    ========================= */
    await Qexecution.queryExecute(
      `INSERT INTO marketplace
       (user_id, order_type, amount, price, status, created_at)
       VALUES (?, 'sell', ?, ?, 'open', NOW())`,
      [user_id, amount, price]
    );

    /* =========================
       RESPONSE
    ========================= */
    res.json({
      status: "success",
      message: "Sell order created",
      details: {
        amount,
        price,
        available_after: available - amount
      }
    });

  } catch (err) {
    console.error("createSellOrderIndividual error:", err);
    res.status(500).json({
      status: "fail",
      message: "Error creating sell order"
    });
  }
};

exports.getIndividualFullSummary = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        status: "fail",
        message: "user_id required"
      });
    }

    /* =========================
       DATE HELPERS
    ========================= */
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM

    /* =========================
       1. CURRENT MONTH
    ========================= */
    const currentRes = await Qexecution.queryExecute(
      `SELECT 
        COALESCE(SUM(unit_used),0) AS units,
        COALESCE(SUM(co2_saved),0) AS co2,
        COALESCE(SUM(tokens_earned),0) AS tokens
       FROM electricity_bills
       WHERE user_id = ?
       AND DATE_FORMAT(month, '%Y-%m') = ?`,
      [user_id, currentMonth]
    );

    const current = {
      units_used: Number(currentRes[0]?.units || 0),
      co2_saved: Number(currentRes[0]?.co2 || 0),
      credits: Number(currentRes[0]?.tokens || 0)
    };

    /* =========================
       2. PREVIOUS MONTHS
    ========================= */
    const prevRes = await Qexecution.queryExecute(
      `SELECT 
        COALESCE(SUM(unit_used),0) AS units,
        COALESCE(SUM(co2_saved),0) AS co2,
        COALESCE(SUM(tokens_earned),0) AS tokens
       FROM electricity_bills
       WHERE user_id = ?
       AND DATE_FORMAT(month, '%Y-%m') < ?`,
      [user_id, currentMonth]
    );

    const previous = {
      units_used: Number(prevRes[0]?.units || 0),
      co2_saved: Number(prevRes[0]?.co2 || 0),
      credits: Number(prevRes[0]?.tokens || 0)
    };

    /* =========================
       3. OVERALL
    ========================= */
    const totalRes = await Qexecution.queryExecute(
      `SELECT 
        COALESCE(SUM(unit_used),0) AS units,
        COALESCE(SUM(co2_saved),0) AS co2,
        COALESCE(SUM(tokens_earned),0) AS tokens
       FROM electricity_bills
       WHERE user_id = ?`,
      [user_id]
    );

    const overall = {
      units_used: Number(totalRes[0]?.units || 0),
      co2_saved: Number(totalRes[0]?.co2 || 0),
      credits: Number(totalRes[0]?.tokens || 0)
    };

    /* =========================
       4. TOKEN BALANCE (FROM TOKENS TABLE)
    ========================= */
    const tokenRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(amount),0) AS total_tokens
       FROM tokens
       WHERE user_id = ?`,
      [user_id]
    );

    const totalTokens = Number(tokenRes[0]?.total_tokens || 0);

    /* =========================
       5. TOKENS LISTED
    ========================= */
    const listedRes = await Qexecution.queryExecute(
      `SELECT COALESCE(SUM(amount),0) AS listed
       FROM marketplace
       WHERE user_id = ?
       AND order_type = 'sell'
       AND status = 'open'`,
      [user_id]
    );

    const listedTokens = Number(listedRes[0]?.listed || 0);

    const availableTokens = totalTokens - listedTokens;

    /* =========================
       6. ACTION
    ========================= */
    let action = "NO_ACTION";

    if (availableTokens > 0) {
      action = "SELL_CREDITS";
    }

    /* =========================
       FINAL RESPONSE
    ========================= */

    res.json({
      status: "success",
      user_id,

      current_month: current,

      previous_months: previous,

      overall: overall,

      tokens: {
        total: totalTokens,
        listed: listedTokens,
        available: availableTokens
      },

      action
    });

  } catch (err) {
    console.error("getIndividualFullSummary error:", err);
    res.status(500).json({
      status: "fail",
      message: "Error fetching summary"
    });
  }
};



/* =========================================
   GenAI (OpenRouter)
========================================= */

async function interpretBillWithAI(text) {
  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "mistralai/mistral-7b-instruct",
      messages: [
        {
          role: "user",
          content: `
Extract:
1. amount_due
2. units_consumed
3. due_date

Return ONLY JSON:
{
 "amount_due": "",
 "units_consumed": "",
 "due_date": ""
}

Bill text:
${text}
`
        }
      ]
    },
    {
      headers: {
        "Authorization": "Bearer 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",
        "Content-Type": "application/json"
      }
    }
  );

  const aiText = response.data.choices[0].message.content;

  try {
    return JSON.parse(aiText);
  } catch {
    return {};
  }
}

/* =========================================
   Helpers
========================================= */

// ── Blockchain: Get tx data for buyListing(listingId) ────────────────────────
// exports.getBuyListingTx = async (req, res) => {
//   try {
//     const { listing_id } = req.body;
//     if (!listing_id) {
//       return res.status(400).json({ status: "fail", message: "listing_id required" });
//     }
//     const txData = await buildTxData(marketplace, "buyListing", [listing_id]);
//     res.json({ status: "success", txData });
//   } catch (err) {
//     console.error("getBuyListingTx error:", err.message);
//     res.status(500).json({ status: "fail", message: err.message });
//   }
// };

function clean(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/R\s*s/gi, "Rs")
    .trim();
}

function extract(text, patterns) {
  for (const regex of patterns) {
    const match = text.match(regex);
    if (match) return match[1].replace(/,/g, "");
  }
  return null;
}

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

    // Convert decimal values to BigInt (18 decimals for token amount; wei for price)
    const amountBN = ethers.parseUnits(String(amount), 18);
    const priceBN = ethers.parseUnits(String(price_per_token), 18);
    console.log("Amount BN:", amountBN.toString());
    // Step 1: approve marketplace to spend tokens
    const approveTxData = await buildTxData(greenCreditToken, "approve", [
      marketplaceAddress,
      amountBN,
    ]);
    console.log("Approve Tx Data:", approveTxData);
    // Step 2: create the listing
    const listingTxData = await buildTxData(marketplace, "createListing", [
      amountBN,
      priceBN,
    ]);
    console.log("Listing Tx Data:", listingTxData);

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
