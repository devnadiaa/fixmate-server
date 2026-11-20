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
    process.env.CLIENT_URL || "http://localhost:3000",
  ],

  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
  },

  user: {
    modelName: "users",
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: true,
      },
      phone: {
        type: "string",
        required: false,
      },
      area: {
        type: "string",
        required: false,
      },
      bio: {
        type: "string",
        required: false,
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const role =
            user.role === "technician" || user.role === "customer"
              ? user.role
              : "customer";

          return {
            data: {
              ...user,
              role,
            },
          };
        },
      },
      update: {
        before: async (userData) => {
          const safeUserData = { ...userData };

          delete safeUserData.role;

          return {
            data: safeUserData,
          };
        },
      },
    },
  },

  plugins: [jwt()],
});

export { auth, client, db };