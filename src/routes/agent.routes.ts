import { Router } from "express";
import { postAgentQuery, postFeedback } from "../controllers/agent.controller";
import { postSignedPayslipUpload } from "../controllers/gcp.controller";
import { payslipUploadMiddleware } from "../middleware/payslipUpload.middleware";

const router = Router();

router.post("/query", payslipUploadMiddleware, postAgentQuery);
router.post("/feedback", postFeedback);
router.post("/payslip/signed-upload", postSignedPayslipUpload);

export default router;
