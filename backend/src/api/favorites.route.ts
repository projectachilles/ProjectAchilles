import { Router, Request, Response } from "express";
import { requireClerkAuth } from "../middleware/clerk.middleware";
import { dataSource } from "../config/orm.config";
import { FavTest } from "../entity/Fav.entity";
import { asyncHandler } from "../middleware/error.middleware";
import { getAuth } from "@clerk/express";

export const favoritesRoute = (): Router => {
  const router = Router();
  router.use(requireClerkAuth());
  const favRepo = dataSource.getRepository(FavTest);
  router.post(
    "/add",
    asyncHandler(async (req: Request, res: Response) => {
      const { test_id } = req.body;
      const user_id = getAuth(req).userId;
      if (!test_id) {
        return res.status(400).json({ error: "test_id is required" });
      }
      if (!user_id) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const newFav = favRepo.create({ test_id, user_id });
      await favRepo.save(newFav);
      res.json(newFav);
    }),
  );

  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const { userId: user_id } = getAuth(req);
      if (!user_id) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const favorites = await favRepo.find({ where: { user_id } });
      const favoriteTestIds = favorites.map((fav) => fav.test_id);
      res.json({ favorites: favoriteTestIds });
    }),
  );
  return router;
};
