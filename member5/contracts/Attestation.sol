// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title FluxAudit report attestation registry
/// @notice Anchors a report body hash and its reasoning-step Merkle root.
/// @dev The deployer is the sole attestor. This prevents arbitrary wallets from
///      making untrusted reports appear to be official FluxAudit attestations.
contract Attestation {
    struct AuditRecord {
        bytes32 reportHash;
        bytes32 merkleRoot;
        uint8 riskScore;
        uint256 timestamp;
        address auditor;
    }

    error UnauthorizedAttestor(address caller);
    error ZeroReportHash();
    error ZeroMerkleRoot();
    error InvalidRiskScore(uint8 riskScore);
    error RecordAlreadyExists(bytes32 reportHash);

    address public immutable authorizedAttestor;
    mapping(bytes32 reportHash => AuditRecord record) public records;

    event Attested(
        bytes32 indexed reportHash,
        bytes32 merkleRoot,
        uint8 riskScore,
        uint256 timestamp,
        address indexed auditor
    );

    constructor() {
        authorizedAttestor = msg.sender;
    }

    /// @notice Anchors one report. A report hash is immutable after anchoring.
    function attest(bytes32 reportHash, bytes32 merkleRoot, uint8 riskScore) external {
        if (msg.sender != authorizedAttestor) {
            revert UnauthorizedAttestor(msg.sender);
        }
        if (reportHash == bytes32(0)) {
            revert ZeroReportHash();
        }
        if (merkleRoot == bytes32(0)) {
            revert ZeroMerkleRoot();
        }
        if (riskScore > 100) {
            revert InvalidRiskScore(riskScore);
        }
        if (records[reportHash].timestamp != 0) {
            revert RecordAlreadyExists(reportHash);
        }

        uint256 attestedAt = block.timestamp;
        records[reportHash] = AuditRecord({
            reportHash: reportHash,
            merkleRoot: merkleRoot,
            riskScore: riskScore,
            timestamp: attestedAt,
            auditor: msg.sender
        });

        emit Attested(reportHash, merkleRoot, riskScore, attestedAt, msg.sender);
    }

    /// @notice Reads the attestation associated with a report body hash.
    function verify(bytes32 reportHash)
        external
        view
        returns (
            bool isVerified,
            bytes32 merkleRoot,
            uint8 riskScore,
            uint256 timestamp,
            address auditor
        )
    {
        AuditRecord memory record = records[reportHash];
        if (record.timestamp == 0) {
            return (false, bytes32(0), 0, 0, address(0));
        }

        return (
            true,
            record.merkleRoot,
            record.riskScore,
            record.timestamp,
            record.auditor
        );
    }
}
