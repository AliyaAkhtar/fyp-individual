const LandownerHandler = require('../Controllers/LandownerController')
// const OffsetProjectHandler = require('../Controllers/OffsetProjectController')
const express= require('express')
const { checkToken } = require('../auth/token_validation')

const router = express.Router();

router.route('/uploadToIPFS')
  .post(
    LandownerHandler.upload,             
    LandownerHandler.uploadProjectToIPFS 
  );

router.route('/processIndustry/:owner_id')
  .get(LandownerHandler.processIndustryEmissions);

router.route('/predict/me')
  .get(checkToken, LandownerHandler.getEmissionForecast);
  
router.route('/plantations/:owner_id')
  .get(LandownerHandler.getPlantation);

// router.route('/industries/:id/emissions')
//   .post(LandownerHandler.submitEmissionLogs);

router.route('/emissions/summary')
  .get(LandownerHandler.compare);

router.route('/tokens/mint')
  .post(LandownerHandler.mintTokens);

router.route('/tokens/:owner_id')
  .get(LandownerHandler.getTokens)

router.route('/marketplace')
  .get(LandownerHandler.viewMarketplace);

router.route('/marketplace/sell/:owner_id')
  .post(LandownerHandler.createMarketplaceListing)

router.route('/land-summary/:owner_id/:registration_id')
  .get(LandownerHandler.landSummary);

// ── Blockchain tx-data routes (frontend signs via MetaMask) ──────────────────
// POST /landowner/blockchain/create-listing  { amount, price_per_token }
//      Returns approveTxData + listingTxData (send in order)
router.route('/blockchain/create-listing')
  .post(LandownerHandler.getCreateListingTx);

// POST /landowner/blockchain/cancel-listing  { chain_listing_id }
router.route('/blockchain/cancel-listing')
  .post(LandownerHandler.getCancelListingTx);

// POST /landowner/blockchain/record-listing  { order_id, chain_listing_id }
router.route('/blockchain/record-listing')
  .post(LandownerHandler.recordChainListing);

// POST /landowner/marketplace/remove  { order_id }  — removes stale DB-only listing
router.route('/marketplace/remove')
  .post(LandownerHandler.removeDbListing);

module.exports = router;