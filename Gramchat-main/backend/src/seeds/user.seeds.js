import "../lib/loadEnv.js";
import { connectDB } from "../lib/db.js";
import bcrypt from "bcryptjs";
import Contact from "../models/contact.model.js";
import { suggestUsername } from "../lib/username.js";
import { pairKey } from "../lib/relations.js";
import { runMigrations } from "../lib/migrate.js";
import User from "../models/user.model.js";

const seedUsers = [
  // Female Users
  {
    email: "emma.thompson@example.com",
    fullName: "Emma Thompson",
    password: "123456",
    profilePic: "",
  },
  {
    email: "olivia.miller@example.com",
    fullName: "Olivia Miller",
    password: "123456",
    profilePic: "",
  },
  {
    email: "sophia.davis@example.com",
    fullName: "Sophia Davis",
    password: "123456",
    profilePic: "",
  },
  {
    email: "ava.wilson@example.com",
    fullName: "Ava Wilson",
    password: "123456",
    profilePic: "",
  },
  {
    email: "isabella.brown@example.com",
    fullName: "Isabella Brown",
    password: "123456",
    profilePic: "",
  },
  {
    email: "mia.johnson@example.com",
    fullName: "Mia Johnson",
    password: "123456",
    profilePic: "",
  },
  {
    email: "charlotte.williams@example.com",
    fullName: "Charlotte Williams",
    password: "123456",
    profilePic: "",
  },
  {
    email: "amelia.garcia@example.com",
    fullName: "Amelia Garcia",
    password: "123456",
    profilePic: "",
  },

  // Male Users
  {
    email: "james.anderson@example.com",
    fullName: "James Anderson",
    password: "123456",
    profilePic: "",
  },
  {
    email: "william.clark@example.com",
    fullName: "William Clark",
    password: "123456",
    profilePic: "",
  },
  {
    email: "benjamin.taylor@example.com",
    fullName: "Benjamin Taylor",
    password: "123456",
    profilePic: "",
  },
  {
    email: "lucas.moore@example.com",
    fullName: "Lucas Moore",
    password: "123456",
    profilePic: "",
  },
  {
    email: "henry.jackson@example.com",
    fullName: "Henry Jackson",
    password: "123456",
    profilePic: "",
  },
  {
    email: "alexander.martin@example.com",
    fullName: "Alexander Martin",
    password: "123456",
    profilePic: "",
  },
  {
    email: "daniel.rodriguez@example.com",
    fullName: "Daniel Rodriguez",
    password: "123456",
    profilePic: "",
  },
];

const seedDatabase = async () => {
  try {
    await connectDB();

    const hashed = await bcrypt.hash("123456", 10);
    const used = new Set();
    const docs = seedUsers.map((u) => {
      let name = suggestUsername(u.fullName), n = 1;
      while (used.has(name)) name = `${name.slice(0, 16)}${++n}`;
      used.add(name);
      return { ...u, username: name, password: hashed };
    });
    const created = await User.insertMany(docs);
    await runMigrations(); // creates the username index
    // make the demo users contacts of each other so they can message right away
    for (let i = 0; i < created.length; i++) for (let j = i + 1; j < created.length; j++) {
      await Contact.create({ requester: created[i]._id, recipient: created[j]._id, pairKey: pairKey(created[i]._id, created[j]._id), status: "accepted" });
    }
    console.log("Database seeded. Log in with a username (e.g. emma_thompson) and password: 123456");
    process.exit(0);
  } catch (error) {
    console.error("Error seeding database:", error.message);
    process.exit(1);
  }
};

// Call the function
seedDatabase();
