import { http, createConfig } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

export const config = createConfig({
  chains: [sepolia],
  connectors: [
    injected(),
    walletConnect({
      projectId: 'ea8a2fcdc8b059d794987604afa740da', // ← ton vrai ID
    }),
  ],
  transports: {
    [sepolia.id]: http(),
  },
})
