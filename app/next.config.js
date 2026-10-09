/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/basket-image/social": ["./public/images/baskets/social/*.jpg"],
  },
};
module.exports = nextConfig;
