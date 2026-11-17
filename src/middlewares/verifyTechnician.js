const verifyTechnician = (req, res, next) => {
  if (req.user.role === "technician") {
    next();
  } else {
    res.status(403).send({ message: "Technician access only" });
  }
};

export default verifyTechnician;