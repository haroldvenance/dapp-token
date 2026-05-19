import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';

// ABIs minimales
const NFT_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function approve(address to, uint256 tokenId) external",
  "function getApproved(uint256 tokenId) view returns (address)"
];

const MARKET_ABI = [
  "function listNFT(uint256 tokenId, uint256 price) external",
  "function buyNFT(uint256 tokenId) external",
  "function cancelListing(uint256 tokenId) external",
  "function listings(uint256 tokenId) view returns (address seller, uint256 price, bool active)",
  "function isListed(uint256 tokenId) view returns (bool)"
];

const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
];

// Adresses déployées sur Sepolia
const NFT_ADDRESS = "0xBAD996537E58F4a72c6d7d0d6ECe38bf43d9d559";
const MARKET_ADDRESS = "0xae1c6E5C3025E13E0bEd276a4a2Cd67c41CE4A28";
const TOKEN_ADDRESS = "0x55E3AC18F352cd77A01612d7C595Cb5bE367FB97";

const TOTAL_NFTS = 10; // NFT #0 à #9

function NftMarketplace({ signer, account }) {
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Charger les métadonnées des 10 NFTs
  useEffect(() => {
    if (!signer) return;
    loadNFTs();
  }, [signer]);

  async function loadNFTs() {
    try {
      const nftContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, signer);
      const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
      const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);

      const items = [];
      for (let i = 0; i < TOTAL_NFTS; i++) {
        try {
          const uri = await nftContract.tokenURI(i);
          const owner = await nftContract.ownerOf(i);
          const listed = await marketContract.isListed(i);
          let listing = null;
          if (listed) {
            const res = await marketContract.listings(i);
            listing = {
              seller: res.seller,
              price: ethers.utils.formatUnits(res.price, 18),
              rawPrice: res.price,
              active: res.active
            };
          }
          // Récupérer le JSON IPFS
          let metadata = { name: `SangoTech #${i}`, image: '' };
          try {
            const httpUri = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
            const resp = await fetch(httpUri);
            if (resp.ok) metadata = await resp.json();
            // Convertir l'image IPFS en URL HTTP
            if (metadata.image && metadata.image.startsWith('ipfs://')) {
              metadata.image = metadata.image.replace('ipfs://', 'https://ipfs.io/ipfs/');
            }
          } catch (e) {
            console.warn('Erreur chargement metadata', i, e.message);
          }
          items.push({
            tokenId: i,
            owner,
            metadata,
            listed,
            listing
          });
        } catch (e) {
          console.warn('Erreur token', i, e.message);
        }
      }
      setNfts(items);
    } catch (err) {
      toast.error('Erreur chargement NFTs');
    } finally {
      setLoading(false);
    }
  }

  // Lister un NFT
  async function handleList(tokenId, price) {
    if (!signer) return;
    try {
      const nftContract = new ethers.Contract(NFT_ADDRESS, NFT_ABI, signer);
      const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
      // 1. Approbation du marketplace pour le NFT
      const approved = await nftContract.getApproved(tokenId);
      if (approved.toLowerCase() !== MARKET_ADDRESS.toLowerCase()) {
        const txApprove = await nftContract.approve(MARKET_ADDRESS, tokenId);
        await txApprove.wait();
        toast.success('Approbation NFT accordée');
      }
      // 2. Lister
      const priceWei = ethers.utils.parseUnits(price, 18);
      const txList = await marketContract.listNFT(tokenId, priceWei);
      await txList.wait();
      toast.success('NFT listé avec succès');
      loadNFTs(); // recharge
    } catch (err) {
      toast.error(err.reason || err.message);
    }
  }

  // Acheter un NFT
  async function handleBuy(tokenId, priceWei) {
    if (!signer) return;
    try {
      const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
      const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
      // 1. Approbation SGC pour le marketplace
      const allowance = await tokenContract.allowance(account, MARKET_ADDRESS);
      if (allowance.lt(priceWei)) {
        const txApprove = await tokenContract.approve(MARKET_ADDRESS, priceWei);
        await txApprove.wait();
        toast.success('Approbation SGC accordée');
      }
      // 2. Acheter
      const txBuy = await marketContract.buyNFT(tokenId);
      await txBuy.wait();
      toast.success('NFT acheté !');
      loadNFTs();
    } catch (err) {
      toast.error(err.reason || err.message);
    }
  }

  // Annuler une vente
  async function handleCancel(tokenId) {
    if (!signer) return;
    try {
      const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
      const tx = await marketContract.cancelListing(tokenId);
      await tx.wait();
      toast.success('Vente annulée');
      loadNFTs();
    } catch (err) {
      toast.error(err.reason || err.message);
    }
  }

  if (loading) return <p className="text-center text-gray-500">Chargement des NFTs...</p>;

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-800">🎨 Galerie SangoTech NFT</h3>

      {/* Grille des NFTs */}
      <div className="grid grid-cols-2 gap-4">
        {nfts.map(item => (
          <div key={item.tokenId} className="bg-white rounded-xl shadow p-2 flex flex-col items-center text-center">
            {item.metadata.image ? (
              <img src={item.metadata.image} alt={item.metadata.name} className="w-full h-32 object-cover rounded-lg" />
            ) : (
              <div className="w-full h-32 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400">Pas d'image</div>
            )}
            <p className="text-sm font-medium mt-1">{item.metadata.name}</p>
            <p className="text-xs text-gray-500">#{item.tokenId}</p>
            <p className="text-xs text-gray-400 truncate w-full" title={item.owner}>
              {item.owner.slice(0,6)}...
            </p>

            {/* Actions selon l'état */}
            {item.listed && item.listing?.active ? (
              <div className="mt-2 w-full">
                <p className="text-xs font-semibold text-green-700">{item.listing.price} SGC</p>
                {item.owner.toLowerCase() === account?.toLowerCase() ? (
                  <button
                    onClick={() => handleCancel(item.tokenId)}
                    className="mt-1 w-full bg-red-500 text-white text-xs py-1 rounded hover:bg-red-600"
                  >
                    Annuler vente
                  </button>
                ) : (
                  <button
                    onClick={() => handleBuy(item.tokenId, item.listing.rawPrice)}
                    className="mt-1 w-full bg-indigo-600 text-white text-xs py-1 rounded hover:bg-indigo-700"
                  >
                    Acheter
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-2 w-full">
                {item.owner.toLowerCase() === account?.toLowerCase() && (
                  <div>
                    <input
                      type="number"
                      placeholder="Prix en SGC"
                      className="w-full text-xs border rounded px-2 py-1 mb-1"
                      id={`price-${item.tokenId}`}
                    />
                    <button
                      onClick={() => {
                        const price = document.getElementById(`price-${item.tokenId}`).value;
                        if (price) handleList(item.tokenId, price);
                      }}
                      className="w-full bg-green-600 text-white text-xs py-1 rounded hover:bg-green-700"
                    >
                      Lister
                    </button>
                  </div>
                )}
                {item.owner.toLowerCase() !== account?.toLowerCase() && (
                  <p className="text-xs text-gray-500">Non listé</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default NftMarketplace;