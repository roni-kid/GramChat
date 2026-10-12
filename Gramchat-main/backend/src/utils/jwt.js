import jwt from "jsonwebtoken";

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "strict",
  // Secure cookies need HTTPS (localhost is exempt). Override with COOKIE_SECURE=false for plain-http LAN testing.
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
});

export const generateToken = (userId, res) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("jwt", token, { ...cookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000 });
  return token;
};
