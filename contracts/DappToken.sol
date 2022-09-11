// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DappToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor() ERC20("DappToken", "DAPP") {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function mintRewards(address _rewardAddr, uint256 _amount)
        public
        onlyRole(MINTER_ROLE)
    {
        _mint(_rewardAddr, _amount);
    }
}
