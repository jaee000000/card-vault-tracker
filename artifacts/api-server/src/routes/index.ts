import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bindersRouter from "./binders";
import cardsRouter from "./cards";
import statsRouter from "./stats";
import scanRouter from "./scan";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/binders", requireAuth, bindersRouter);
router.use("/cards", requireAuth, cardsRouter);
router.use("/stats", requireAuth, statsRouter);
router.use("/scan", requireAuth, scanRouter);

export default router;
