import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bindersRouter from "./binders";
import cardsRouter from "./cards";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/binders", bindersRouter);
router.use("/cards", cardsRouter);
router.use("/stats", statsRouter);

export default router;
