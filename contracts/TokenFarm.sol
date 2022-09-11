// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "hardhat/console.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./DappToken.sol";
import "./LPToken.sol";

contract TokenFarm is Ownable, ReentrancyGuard {
    string public name = "Rooftop Token Farm";

    DappToken public dappToken; // reward token
    LPToken public lpToken; // mock LP Token staked by users

    // rewards per block
    uint256 public constant MAX_REWARD_PER_BLOCK = 100e18;
    uint256 public rewardPerBlock;
    uint256 public totalStaked;
    uint256 public rewardPerShareStored;
    uint256 public lastDistributionBlock;

    // iterable list of staking users
    address[] public stakers;

    struct User {
        uint256 stakingBalance;
        uint256 rewardPerSharePaid;
        // Rewards available to harvest
        uint256 pendingRewards;
        // keeps track of addresses index in the stakers array (1 based index, there's no 0 index)
        uint256 stakersIndex;
        bool hasStaked;
        bool isStaking;
    }

    mapping(address => User) public users;

    event Deposit(address from, uint256 amount);
    event Withdraw(address to, uint256 amount);
    event Harvest(address to, uint256 amount);
    event Distribute(uint256 distributed);
    event NewRewardPerBlock(uint256 newReward);

    modifier isStaker() {
        require(users[msg.sender].isStaking, "Nothing staked.");
        _;
    }

    constructor(DappToken _dappToken, LPToken _lpToken) {
        dappToken = DappToken(_dappToken);
        lpToken = LPToken(_lpToken);
        rewardPerBlock = 1e18;
    }

    /**
     @notice Deposit
     Users deposits LP Tokens
     */
    function deposit(uint256 _amount) public nonReentrant {
        // Check amount
        require(_amount > 0, "Amount should be greater than 0.");
        // Check allowance
        uint256 remainderAllowance = ERC20(lpToken).allowance(
            msg.sender,
            address(this)
        );
        require(remainderAllowance >= _amount, "Not enough allowance.");

        // Transfer tokens
        ERC20(lpToken).transferFrom(msg.sender, address(this), _amount);
        // First of all, distribute rewards. This way the current deposit won't affect
        // the rewards previous users have captured. And the current depositor will start
        // with a clean sheet.
        distributeRewards(msg.sender);
        // Update staking balance
        users[msg.sender].stakingBalance += _amount;
        totalStaked += _amount;
        // Check whether the user was staking already, if that's not the case (a.k.a first deposit)
        // then update the isStaking mapping to reflect that the user is now staking,
        // keep the stakers array in sync
        if (!users[msg.sender].isStaking) {
            users[msg.sender].isStaking = true;
            stakers.push(msg.sender);
            users[msg.sender].stakersIndex = stakers.length; // Save 1-based index
        }

        // emit deposit event
        emit Deposit(msg.sender, _amount);
    }

    /**
     @notice Withdraw
     Unstaking LP Tokens (Withdraw all LP Tokens)
     */
    function withdraw() public isStaker nonReentrant {
        // Fetch staking balance
        uint256 balance = users[msg.sender].stakingBalance;
        // Require amount greater than 0
        require(balance > 0, "There is no staking balance.");
        // calculate rewards before reseting staking balance
        distributeRewards(msg.sender);
        // Reset staking balance
        users[msg.sender].stakingBalance = 0;
        totalStaked -= balance;
        // Update staking status
        users[msg.sender].isStaking = false;
        users[msg.sender].hasStaked = true;
        removeStaker(msg.sender);
        // emit some event
        emit Withdraw(msg.sender, balance);
        // Transfer LP Tokens to user
        ERC20(lpToken).transfer(msg.sender, balance);
    }

    function rewardsPerShare() public view returns (uint256) {
        // The first time rewards per share will always be 0
        if (totalStaked == 0) {
            return rewardPerShareStored;
        }

        // After we have some token staked, then it will be calculated as
        // the previous reward per share plus the amount of rewards accumulated
        // since the last distribution divided by the total amount staked
        return
            rewardPerShareStored +
            ((rewardPerBlock * (block.number - lastDistributionBlock) * 1e18) /
                totalStaked);
    }

    /**
        Pending rewards (or available to harvest) is calculated as the existing
        pending rewards plus the current staking balance for the user multiplied
        by the difference between the rewards per share and the rewards per share
        paid to the current user
     */
    function pendingReward(address _user) public view returns (uint256) {
        return
            ((users[_user].stakingBalance *
                (rewardsPerShare() - users[_user].rewardPerSharePaid)) / 1e18) +
            users[_user].pendingRewards;
    }

    /**
     @notice Claim Rewards
     Users harvest pendig rewards
     Pendig rewards are minted to the user
     */
    function harvest() public nonReentrant {
        distributeRewards(msg.sender);
        // fetch pendig rewards
        uint256 rewards = users[msg.sender].pendingRewards;
        // check if user has pending rewards
        require(rewards > 0, "No pending rewards.");
        // reset pendig rewards balance
        users[msg.sender].pendingRewards = 0;
        // mint rewards tokens to user
        DappToken(dappToken).mintRewards(msg.sender, rewards);
        // emit some event
        emit Harvest(msg.sender, rewards);
    }

    // Restricted Functions (owner)

    function updateRewardPerBlock(uint256 _newReward)
        public
        onlyOwner
        nonReentrant
    {
        require(_newReward <= MAX_REWARD_PER_BLOCK, "Exceeds maximum reward.");
        uint256 distributedRewards = _distributeRewardsForAll();
        emit Distribute(distributedRewards);
        rewardPerBlock = _newReward;
        emit NewRewardPerBlock(_newReward);
    }

    /**
     @notice Distribute rewards 
     Distribute rewards for all staking user
     Only owner can call this function
     */
    function distributeRewardsAll() external onlyOwner nonReentrant {
        uint256 distributedRewards = _distributeRewardsForAll();
        // emit Distribute event
        emit Distribute(distributedRewards);
    }

    function _distributeRewardsForAll() internal returns (uint256) {
        uint256 distributedRewards;
        // Distribute rewards to all stakers
        for (uint256 i = 0; i < stakers.length; i++) {
            distributedRewards += distributeRewards(stakers[i]);
        }

        return distributedRewards;
    }

    /**
     @notice Distribute rewards
     calculates rewards for the indicated beneficiary 
     */
    function distributeRewards(address beneficiary) private returns (uint256) {
        // Update reward per share
        rewardPerShareStored = rewardsPerShare();
        // Update last distribution
        lastDistributionBlock = block.number;

        if (beneficiary != address(0)) {
            // Capture old reward before updating
            uint256 oldRewards = users[beneficiary].pendingRewards;
            // Update pending rewards
            users[beneficiary].pendingRewards = pendingReward(beneficiary);
            // Update reward per share paid to the user
            users[beneficiary].rewardPerSharePaid = rewardPerShareStored;

            // Calculate and return the amount of rewards actually distributed
            return users[beneficiary].pendingRewards - oldRewards;
        }

        return 0;
    }

    /**
     * Removes a staker by copying the last staker in the array
     * the the index we want to remove (overwrite).
     * And then remove the last staker, and adjust the indexes accordingly
     *
     * IMPORTANT: Remember stakersIndex has a 1-based index, so we need to subtract 1
     * before accessing the stakers array
     */
    function removeStaker(address staker) internal {
        // Only remove if staker is present ( > 0)
        if (users[staker].stakersIndex > 0) {
            // the index we want to remove (convert to 0-based index)
            uint256 index = users[staker].stakersIndex - 1;
            // the last staker we want to copy to index
            address lastStaker = stakers[stakers.length - 1];
            // copy lastStaker and overwrite the staker we want to remove
            stakers[index] = lastStaker;
            // update the index for lastStaker (convert back to 1-based index)
            users[lastStaker].stakersIndex = index + 1;
            // Remove the last element from the array
            stakers.pop();
            // Remove staker from the mapping
            users[staker].stakersIndex = 0;
        }
    }
}
