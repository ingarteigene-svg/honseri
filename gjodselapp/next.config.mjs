// GitHub Pages serverer prosjektsider under en understi (/honseri/gjodsel).
// Workflowen setter NEXT_PUBLIC_BASE_PATH=/honseri/gjodsel; lokalt er den tom.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export', // statisk eksport – appen trenger ingen server
  basePath,
  // Mappebaserte URL-er (logg/index.html i stedet for logg.html):
  // fungerer på alle statiske servere, ikke bare GitHub Pages.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
