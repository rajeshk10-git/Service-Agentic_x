import { Router } from "express";
import { postInternalParseTask } from "../controllers/internal.controller";

const router = Router();

router.post("/tasks/parse", postInternalParseTask);

export default router;
