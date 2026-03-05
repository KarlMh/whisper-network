/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true
  },
  typescript: {
    ignoreBuildErrors: false
  },
  webpack: (config) => {
    config.resolve.alias['react-native'] = 'react-native-web'
    return config
  }
}

module.exports = nextConfig
