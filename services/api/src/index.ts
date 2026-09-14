import express from "express";
import { curateRouter } from "./routes/curate.js";

const app = express();
app.use(express.json());
app.use("/api/curate", curateRouter);

const port = process.env.PORT ?? 8080;
app.listen(port, () => {
  console.log(`Mosaé API listening on port ${port}`);
});
