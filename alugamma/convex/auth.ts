import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

import { normalizeEmail } from "./helpers";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: (params) => {
        if (typeof params.email !== "string") {
          throw new Error("Email is required.");
        }

        const email = normalizeEmail(params.email);
        const suppliedName = typeof params.name === "string" ? params.name.trim() : "";

        return {
          email,
          name: suppliedName.length > 0 ? suppliedName : email.split("@")[0],
        };
      },
    }),
  ],
});
