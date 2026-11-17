import express from "express";
import { db } from "./auth.js";
import verifyToken from "./middlewares/verifyToken.js";

const router = express.Router();

const usersCollection = db.collection("users");

router.get("/", verifyToken, async (req, res) => {
  try {
    const user = await usersCollection.findOne(
      { email: req.user.email },
      {
        projection: {
          name: 1,
          email: 1,
          role: 1,
          phone: 1,
          area: 1,
          bio: 1
        }
      }
    );

    if (user === null) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send(user);
  } catch (error) {
    res.status(500).send({ message: "Failed to get profile" });
  }
});

router.patch("/", verifyToken, async (req, res) => {
  try {
    const { name, phone, area, bio } = req.body;

    const result = await usersCollection.updateOne(
      { email: req.user.email },
      {
        $set: {
          name,
          phone,
          area,
          bio,
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send({ message: "Profile updated successfully" });
  } catch (error) {
    res.status(500).send({ message: "Failed to update profile" });
  }
});

export default router;