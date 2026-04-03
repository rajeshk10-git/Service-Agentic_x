import { Router } from "express";
import { postAgentQuery, postChatFeedback } from "../controllers/agent.controller";
import { postSignedPayslipUpload } from "../controllers/gcp.controller";
import { requireJwtUserId } from "../middleware/auth.middleware";
import { payslipUploadMiddleware } from "../middleware/payslipUpload.middleware";

const router = Router();

router.post(
  "/query",
  payslipUploadMiddleware,
  requireJwtUserId,
  postAgentQuery,
);
router.post("/feedback", requireJwtUserId, postChatFeedback);
router.post("/payslip/signed-upload", postSignedPayslipUpload);

export default router;
