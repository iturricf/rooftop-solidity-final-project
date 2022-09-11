// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LPToken is ERC20, Ownable {
    constructor() ERC20("LPToken", "LPT") {}

    // Required for testing purposes only
    function mintTo(address _addr, uint256 _amount) public onlyOwner {
        _mint(_addr, _amount);
    }
}
