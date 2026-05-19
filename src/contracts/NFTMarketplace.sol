// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract NFTMarketplace is Ownable, ReentrancyGuard {
    IERC20 public paymentToken;
    IERC721 public nftContract;

    struct Listing {
        address seller;
        uint256 price;       // en unités SGC (18 décimales)
        bool active;
    }

    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Sale(uint256 indexed tokenId, address indexed buyer, uint256 price);
    event Cancelled(uint256 indexed tokenId);

    constructor(address _nft, address _token) Ownable(msg.sender) {
        nftContract = IERC721(_nft);
        paymentToken = IERC20(_token);
    }

    // Lister un NFT à vendre
    function listNFT(uint256 tokenId, uint256 price) external {
        require(price > 0, "Prix invalide");
        require(nftContract.ownerOf(tokenId) == msg.sender, "Pas proprietaire");
        require(
            nftContract.getApproved(tokenId) == address(this),
            "Approbation marketplace manquante"
        );

        listings[tokenId] = Listing(msg.sender, price, true);
        emit Listed(tokenId, msg.sender, price);
    }

    // Acheter un NFT listé
    function buyNFT(uint256 tokenId) external nonReentrant {
        Listing storage listing = listings[tokenId];
        require(listing.active, "Pas a vendre");
        require(listing.seller != msg.sender, "Acheteur = vendeur");

        // 1. Transférer les SGC de l'acheteur vers le vendeur
        bool success = paymentToken.transferFrom(msg.sender, listing.seller, listing.price);
        require(success, "Paiement echoue");

        // 2. Transférer le NFT du vendeur vers l'acheteur
        nftContract.safeTransferFrom(listing.seller, msg.sender, tokenId);

        // 3. Désactiver la vente
        listing.active = false;

        emit Sale(tokenId, msg.sender, listing.price);
    }

    // Annuler une vente
    function cancelListing(uint256 tokenId) external {
        Listing storage listing = listings[tokenId];
        require(listing.active, "Pas a vendre");
        require(listing.seller == msg.sender, "Pas le vendeur");

        listing.active = false;
        emit Cancelled(tokenId);
    }

    // Vérifier qu'un token est en vente
    function isListed(uint256 tokenId) external view returns (bool) {
        return listings[tokenId].active;
    }
}
