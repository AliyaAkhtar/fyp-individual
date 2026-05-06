const express = require("express");
const IndustryController = require("../Controllers/IndustryController");

const router = express.Router();

// router.route('/emissions')
//   .post(IndustryController.reportEmissions);

router.route('/processIndustry/:industry_id')
  .get(IndustryController.processIndustryEmissions);

router.route('/dashboard/:industry_id')
  .get(IndustryController.getIndustryDashboard);

router.route('/listing/:industry_id')
  .get(IndustryController.getMyListings);

router.route('/marketplace')
  .get(IndustryController.viewMarketplace);

router.route('/marketplace/sell/:industry_id')
  .post(IndustryController.createSellOrderIndustry)

router.route('/predict/:industryId')
  .get(IndustryController.getEmissionForecast);

// ── Blockchain tx-data routes (frontend signs via MetaMask) ──────────────────
// POST /industry/blockchain/register          → registerEmitter()
router.route('/blockchain/register')
  .post(IndustryController.getRegisterEmitterTx);

// POST /industry/blockchain/offset  { credits } → offsetEmissions(credits)
router.route('/blockchain/offset')
  .post(IndustryController.getOffsetEmissionsTx);

// POST /industry/blockchain/retire  { amount }  → retire(amount)
router.route('/blockchain/retire')
  .post(IndustryController.getRetireCreditsTx);

// POST /industry/blockchain/buy     { listing_id } → buyListing(listingId)
router.route('/blockchain/buy')
  .post(IndustryController.getBuyListingTx);

// POST /industry/blockchain/report-emissions  { tons } → emitterRegistry.reportEmissions(tons)
// Call this alongside /industry/emissions to store on-chain + DB simultaneously
router.route('/blockchain/report-emissions')
  .post(IndustryController.getReportEmissionsTx);

module.exports = router;
