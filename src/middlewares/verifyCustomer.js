const verifyCustomer = (req, res, next) => {
  if (req.user.role === "customer") {
    next();
  } else {
    res.status(403).send({ message: "Customer access only" });
  }
};

export default verifyCustomer;