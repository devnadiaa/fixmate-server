import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.BETTER_AUTH_URL}/api/auth/jwks`)
);

const verifyToken = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (authorization && authorization.startsWith("Bearer ")) {
      const token = authorization.split(" ")[1];

      const { payload } = await jwtVerify(token, JWKS, {
        issuer: process.env.BETTER_AUTH_URL,
        audience: process.env.BETTER_AUTH_URL
      });

      req.user = payload;
      next();
    } else {
      res.status(401).send({ message: "Unauthorized access" });
    }
  } catch (error) {
    res.status(401).send({ message: "Invalid or expired token" });
  }
};

export default verifyToken;