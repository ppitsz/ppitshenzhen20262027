/** @type {import('next').NextConfig} */
const nextConfig = {
    serverExternalPackages: ["firebase-admin", "@react-pdf/renderer", "pdfkit"],

    outputFileTracingIncludes: {
    '/api/**/*': [
      '**/node_modules/pdfkit/js/data/*.afm',
      '**/node_modules/pdfkit/js/standard-fonts/*.cjs',
      '**/node_modules/@react-pdf/**/node_modules/pdfkit/js/standard-fonts/*.cjs',
    ],
  },
};

export default nextConfig;