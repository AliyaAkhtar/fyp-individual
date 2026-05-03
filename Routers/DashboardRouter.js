const express = require("express");
const DashboardController = require("../Controllers/DashboardController");

const router = express.Router();

/* =========================
   INDUSTRY APIS
========================= */
router.route("/process-emissions/:industry_id")
  .post(DashboardController.processIndustryEmissions);

router.route("/industry-details/:industry_id")
  .get(DashboardController.getIndustryEmissionDetails);

router.route("/redeem-credits/:industry_id/:order_id")
  .post(DashboardController.redeemCarbonCredits);

/* =========================
   LANDOWNER APIS
========================= */
router.route("/landowner/process-emissions/:owner_id")
  .post(DashboardController.processLandownerEmissions);

router.route("/landowner/details/:owner_id")
  .get(DashboardController.getLandownerEmissionDetails);

router.route("/landowner/apply-offset/:owner_id")
  .post(DashboardController.applyLandownerOffset);

router.route("/landowner/buy-credits/:owner_id/:order_id")
  .post(DashboardController.landownerBuyCredits);


router.get("/owner/:owner_id/monthly-history", DashboardController.getOwnerMonthlyHistory);
router.get("/industry/:industry_id/monthly-history", DashboardController.getIndustryMonthlyHistory);

module.exports = router;