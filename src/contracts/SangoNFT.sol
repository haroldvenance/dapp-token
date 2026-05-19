// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SangoNFT is ERC721URIStorage, Ownable {
    uint256 public nextTokenId;

    constructor() ERC721("SangoTech NFT", "STN") Ownable(msg.sender) {}

    function mint(address to, string memory uri) public onlyOwner returns (uint256) {
        uint256 tokenId = nextTokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        nextTokenId++;
        return tokenId;
    }
}


