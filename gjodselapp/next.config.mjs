// GitHub Pages serverer prosjektsider under en understi (/honseri).
// Workflowen setter NEXT_PUBLIC_BASE_PATH=/honseri; lokalt er den tom.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export', // statisk eksport – appen trenger ingen server
  basePath,
  images: { unoptimized: true },
};

export default nextConfig;
