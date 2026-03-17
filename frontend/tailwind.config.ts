import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        parliament: {
          green: "#006B3F",
          gold: "#FDB913",
          navy: "#003087",
          light: "#F0F4F8",
        },
      },
    },
  },
  plugins: [],
};
export default config;
