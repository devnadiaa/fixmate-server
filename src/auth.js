import "dotenv/config";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { jwt } from "better-auth/plugins";
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);

const db = client.db(process.env.DB_NAME);

const auth = betterAuth({
  database: mongodbAdapter(db, { client }),

  secret: process.env.BETTER_AUTH_SECRET,

  baseURL: process.env.BETTER_AUTH_URL,

  trustedOrigins: [
    process.env.CLIENT_URL || "http://localhost:3000"
  ],

  emailAndPassword: {
    enabled: true
  },

  user: {
    modelName: "users",
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: false
      }
    }
  },

  plugins: [jwt()]
});

export { auth, client, db };