import express from "express";
import { ObjectId } from "mongodb";
import { db } from "./auth.js";
import verifyToken from "./middlewares/verifyToken.js";
import verifyTechnician from "./middlewares/verifyTechnician.js";

const router = express.Router();

const servicesCollection = db.collection("services");

router.get("/", async (req, res) => {
  try {
    const query = {
      approvalStatus: "approved",
      isAvailable: true
    };

    if (req.query.search) {
      query.title = {
        $regex: req.query.search,
        $options: "i"
      };
    }

    if (req.query.category) {
      query.category = req.query.category;
    }

    if (req.query.serviceMode) {
      query.serviceMode = req.query.serviceMode;
    }

    let sortOption = { createdAt: -1 };

    if (req.query.sort === "price-low") {
      sortOption = { basePrice: 1 };
    }

    if (req.query.sort === "price-high") {
      sortOption = { basePrice: -1 };
    }

    const services = await servicesCollection
      .find(query)
      .sort(sortOption)
      .toArray();

    res.send(services);
  } catch (error) {
    res.status(500).send({ message: "Failed to get services" });
  }
});

router.get("/my-services", verifyToken, verifyTechnician, async (req, res) => {
  try {
    const services = await servicesCollection
      .find({ technicianEmail: req.user.email })
      .toArray();

    res.send(services);
  } catch (error) {
    res.status(500).send({ message: "Failed to get your services" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const service = await servicesCollection.findOne({
      _id: new ObjectId(req.params.id),
      approvalStatus: "approved",
      isAvailable: true
    });

    if (service === null) {
      return res.status(404).send({ message: "Service not found" });
    }

    res.send(service);
  } catch (error) {
    res.status(500).send({ message: "Failed to get service" });
  }
});

router.post("/", verifyToken, verifyTechnician, async (req, res) => {
  try {
    const service = {
      ...req.body,
      basePrice: Number(req.body.basePrice),
      technicianName: req.user.name,
      technicianEmail: req.user.email,
      approvalStatus: "pending",
      isAvailable: true,
      createdAt: new Date()
    };

    const result = await servicesCollection.insertOne(service);

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to add service" });
  }
});

router.patch("/:id", verifyToken, verifyTechnician, async (req, res) => {
  try {
    const result = await servicesCollection.updateOne(
      {
        _id: new ObjectId(req.params.id),
        technicianEmail: req.user.email
      },
      {
        $set: {
          ...req.body,
          approvalStatus: "pending",
          updatedAt: new Date()
        }
      }
    );

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to update service" });
  }
});

router.delete("/:id", verifyToken, verifyTechnician, async (req, res) => {
  try {
    const result = await servicesCollection.deleteOne({
      _id: new ObjectId(req.params.id),
      technicianEmail: req.user.email
    });

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to delete service" });
  }
});

export default router;