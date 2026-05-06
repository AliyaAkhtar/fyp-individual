const express = require("express");
const router = express.Router();

const individualController = require("../Controllers/IndividualController");

router.route('/analyze-bill')
  .post(individualController.uploadBill, individualController.analyzeElectricityBill);

router.route('/calculate-offset/:bill_id')
  .post(individualController.calculateCarbonOffset);

router.route('/marketplace/:user_id')
  .get(individualController.viewMarketplace);

// POST /individual/blockchain/create-listing  { amount, price_per_token }
//      Returns approveTxData + listingTxData (send in order)
router.route('/blockchain/create-listing')
  .post(individualController.getCreateListingTx);

router.route('/marketplace/sell/:user_id')
  .post(individualController.createSellOrderIndividual)

router.route('/summary/:user_id')
  .get(individualController.getIndividualFullSummary);



module.exports = router;