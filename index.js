const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { checkToken } = require("./auth/token_validation")
const query = require("./query");
const userRouter = require('./api/users/user.router');
const IndividualRouter = require("./Routers/IndividualRouter");
const IndustryRouter = require('./Routers/IndustryRouter');
const GovernmentRouter = require('./Routers/GovernmentRouter');
const LandownerRouter = require('./Routers/LandownerRouter');
const DashboardRouter = require("./Routers/DashboardRouter");

let app = express();

app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = new Set([
      'https://climavert.vercel.app/',
      'http://localhost:5173',
      'http://localhost:8080',
      'http://localhost:8081',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:8080',
      'http://127.0.0.1:8081',
      'http://localhost:3000',
      'https://learn-lime-three.vercel.app'
    ]);

    // allow Postman / server calls
    if (!origin) return callback(null, true);

    // allow all your dev origins
    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    // TEMP DEV MODE: allow everything (optional)
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// Middleware to enable CORS
// app.use((req, res, next) => {
//   res.setHeader('Access-Control-Allow-Origin', '*'); 
//   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
//   res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
//   res.setHeader('Access-Control-Allow-Credentials', 'true'); 
//   next();
// });

// app.use(cors({
//   origin: ['*'], 
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
//   credentials: true 
// }));

// app.use(cors({
//   origin: "*",
//   methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
//   allowedHeaders: ['Content-Type','Authorization']
// }));

// Middleware to handle large payloads
app.use(bodyParser.json({ limit: '200mb' }));
app.use(bodyParser.urlencoded({ limit: '200mb', extended: true }));
app.use(express.json());

// POST route to add CO2 log
app.post('/addData', async (req, res) => {
  try {
    const { co2_emitted, industry_id } = req.body;

    if (co2_emitted === undefined || industry_id == undefined) {
      return res.status(400).json({ error: 'co2_emitted is required' });
    }

    const sql = `
      INSERT INTO hardware_logs (datetime, co2_emitted, industry_id)
      VALUES (NOW(), ?, ?)
    `;

    const result = await query.queryExecute(sql, [co2_emitted,industry_id]);

    res.status(201).json({
      message: 'Log added successfully',
      log: { log_id: result.insertId, datetime: new Date(), co2_emitted }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/getCarbonPrice', async (req, res) => {
  try {
    const cheerio = require("cheerio");

    // 🔹 Step 1: Fetch carbon price (EUR) — DO NOT CHANGE (your working logic)
    const response = await fetch("https://tradingeconomics.com/commodity/carbon");
    const html = await response.text();
    const $ = cheerio.load(html);

    let priceText = $("td:contains('EU Carbon Permits')")
      .next()
      .text()
      .trim();

    // ✅ Clean price
    const eurPrice = parseFloat(priceText.replace(/[^\d.]/g, ""));

    if (!eurPrice) {
      return res.status(500).json({ error: 'Failed to extract carbon price' });
    }

    // 🔹 Step 2: Convert EUR → PKR (FIXED & STABLE)
    let pkrPrice = null;

    try {
      const rateRes = await fetch("https://api.fxratesapi.com/latest?base=EUR");
      const rateData = await rateRes.json();

      // console.log(rateData)

      const rate = rateData?.rates?.PKR;

      console.log(rate)

      if (typeof rate === "number") {
        pkrPrice = Math.round(eurPrice * rate);
      } else {
        throw new Error("PKR rate not found");
      }

    } catch (convErr) {
      console.error("Currency conversion failed:", convErr.message);

      // 🔥 fallback (safe for demo + production stability)
      const fallbackRate = 300;
      pkrPrice = Math.round(eurPrice * fallbackRate);
    }

    // 🔹 Step 3: Response
    return res.status(200).json({
      message: 'Carbon price fetched successfully',
      data: {
        eur_price: eurPrice,
        pkr_price: pkrPrice,
        unit: 'per ton CO2',
        market: 'EU ETS',
        currency_base: 'EUR',
        converted_to: 'PKR',
        datetime: new Date()
      }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// app.use(cors({
//   origin: ['http://localhost:5173', 'https://learn-lime-three.vercel.app'],
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
//   credentials: true // Allow credentials (cookies) to be included with requests
// }));
app.get('/', (req, res) => {
  res.json({
    message: "FYP Backend is Running 🚀",
    status: "OK"
  });
});

// const corsOptions = {
//   origin: ['http://localhost:5173', 'https://learn-lime-three.vercel.app', '*'], 
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], // Allowed methods
//   credentials: true // Allow credentials
// };

// console.log("userRouter:", userRouter);
// console.log("IndividualRouter:", IndividualRouter);
app.use('/users', userRouter)
app.use("/individual", IndividualRouter);
app.use('/dashboard', DashboardRouter);
app.use('/landowner', LandownerRouter);
app.use('/industry', IndustryRouter);
app.use('/government',GovernmentRouter);

const port = process.env.PORT || 2000;

// Start server
app.listen(port, () => {
  console.log("Server has started on port 2000");
});

require("./Blockchain/eventListener");