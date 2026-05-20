package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.JsonNode;
import dev.burnedchats.exception.WalletProofException;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;

/**
 * Address parsing, payload hashing, and logging helpers for {@link TonProofVerifier}.
 */
final class TonProofSupport {

    private static final byte[] TON_CONNECT_PREFIX = "ton-connect".getBytes(StandardCharsets.UTF_8);
    private static final byte[] TON_PROOF_PREFIX = "ton-proof-item-v2/".getBytes(StandardCharsets.UTF_8);
    private static final byte[] TON_HEADER_PREFIX = new byte[]{(byte) 0xFF, (byte) 0xFF};
    private static final byte[] ED25519_SPKI_PREFIX = HexFormat.of().parseHex("302a300506032b6570032100");

    private TonProofSupport() {
    }

    record ParsedAddress(String original, int workchain, byte[] hashPart, String canonicalRaw) {
    }

    record ParsedProof(ParsedAddress parsedAddress, TonProof proof) {
    }

    record TonProof(long timestamp, TonProofDomain domain, String signature, String payload) {
        TonProof {
            if (payload == null) {
                throw new WalletProofException(
                        WalletProofException.Reason.NONCE_MISSING,
                        "TON proof payload nonce is required",
                        null);
            }
        }
    }

    record TonProofDomain(String value, Integer lengthBytes) {
    }

    static ParsedAddress parseAddress(String address) {
        String trimmed = address.trim();
        if (trimmed.contains(":")) {
            return parseRawAddress(trimmed);
        }
        return parseFriendlyAddress(trimmed);
    }

    private static ParsedAddress parseRawAddress(String trimmed) {
        String[] parts = trimmed.split(":", 2);
        if (parts.length != 2) {
            throw new WalletProofException(
                    WalletProofException.Reason.ADDRESS_INVALID, "Invalid raw TON address", null);
        }
        int workchain;
        try {
            workchain = Integer.parseInt(parts[0]);
        } catch (NumberFormatException ex) {
            throw new WalletProofException(
                    WalletProofException.Reason.ADDRESS_INVALID, "Invalid raw TON address workchain", ex);
        }
        byte[] hash;
        try {
            hash = HexFormat.of().parseHex(parts[1]);
        } catch (IllegalArgumentException ex) {
            throw new WalletProofException(
                    WalletProofException.Reason.ADDRESS_INVALID, "Invalid raw TON address hash", ex);
        }
        if (hash.length != 32) {
            throw new WalletProofException(
                    WalletProofException.Reason.ADDRESS_INVALID, "TON address hash must be 32 bytes", null);
        }
        return new ParsedAddress(trimmed, workchain, hash, workchain + ":" + HexFormat.of().formatHex(hash));
    }

    private static ParsedAddress parseFriendlyAddress(String trimmed) {
        byte[] friendly = decodeBase64Any(trimmed);
        if (friendly.length != 36) {
            throw new WalletProofException(
                    WalletProofException.Reason.ADDRESS_INVALID, "Invalid user-friendly TON address length", null);
        }
        byte[] body = Arrays.copyOfRange(friendly, 0, 34);
        byte[] checksum = Arrays.copyOfRange(friendly, 34, 36);
        byte[] expectedChecksum = crc16Xmodem(body);
        if (!Arrays.equals(checksum, expectedChecksum)) {
            throw new WalletProofException(
                    WalletProofException.Reason.ADDRESS_INVALID, "Invalid TON address checksum", null);
        }
        int workchain = body[1];
        byte[] hash = Arrays.copyOfRange(body, 2, 34);
        return new ParsedAddress(trimmed, workchain, hash, workchain + ":" + HexFormat.of().formatHex(hash));
    }

    static byte[] buildSignedPayload(ParsedProof parsed) throws GeneralSecurityException {
        ParsedAddress address = parsed.parsedAddress();
        TonProof proof = parsed.proof();

        byte[] domainBytes = proof.domain().value().getBytes(StandardCharsets.UTF_8);
        byte[] payloadBytes = proof.payload().getBytes(StandardCharsets.UTF_8);

        ByteBuffer message = ByteBuffer.allocate(
                TON_PROOF_PREFIX.length + 4 + 32 + 4 + domainBytes.length + 8 + payloadBytes.length);
        message.put(TON_PROOF_PREFIX);
        message.putInt(address.workchain());
        message.put(address.hashPart());
        message.order(ByteOrder.LITTLE_ENDIAN);
        message.putInt(domainBytes.length);
        message.put(domainBytes);
        message.putLong(proof.timestamp());
        message.put(payloadBytes);

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] messageHash = digest.digest(message.array());

        int finalMsgLen = TON_HEADER_PREFIX.length + TON_CONNECT_PREFIX.length + messageHash.length;
        ByteBuffer finalMessage = ByteBuffer.allocate(finalMsgLen);
        finalMessage.put(TON_HEADER_PREFIX);
        finalMessage.put(TON_CONNECT_PREFIX);
        finalMessage.put(messageHash);

        return digest.digest(finalMessage.array());
    }

    static boolean verifyEd25519(byte[] rawPublicKey, byte[] message, byte[] signature)
            throws GeneralSecurityException {
        int encKeyLen = ED25519_SPKI_PREFIX.length + rawPublicKey.length;
        byte[] encodedPublicKey = new byte[encKeyLen];
        System.arraycopy(ED25519_SPKI_PREFIX, 0, encodedPublicKey, 0, ED25519_SPKI_PREFIX.length);
        System.arraycopy(rawPublicKey, 0, encodedPublicKey, ED25519_SPKI_PREFIX.length, rawPublicKey.length);

        KeyFactory keyFactory = KeyFactory.getInstance("Ed25519");
        Signature verifier = Signature.getInstance("Ed25519");
        verifier.initVerify(keyFactory.generatePublic(new X509EncodedKeySpec(encodedPublicKey)));
        verifier.update(message);
        return verifier.verify(signature);
    }

    static byte[] decodeSignature(String signature) {
        byte[] decoded = decodeBase64Any(signature);
        if (decoded.length != 64) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "TON proof signature must be 64 bytes", null);
        }
        return decoded;
    }

    static byte[] decodeBase64Any(String value) {
        if (value == null || value.isBlank()) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "Base64 value is required", null);
        }
        String normalized = value.trim();
        int mod = normalized.length() % 4;
        if (mod > 0) {
            normalized = normalized + "=".repeat(4 - mod);
        }
        try {
            return Base64.getDecoder().decode(normalized);
        } catch (IllegalArgumentException ignored) {
            return Base64.getUrlDecoder().decode(normalized);
        }
    }

    static String shortAddr(String addr) {
        if (addr == null || addr.isBlank()) {
            return "";
        }
        String trimmed = addr.trim();
        if (trimmed.contains(":")) {
            String[] parts = trimmed.split(":", 2);
            if (parts.length == 2 && parts[1].length() >= 16) {
                String hex = parts[1];
                return parts[0] + ":" + hex.substring(0, 8) + "..." + hex.substring(hex.length() - 8);
            }
            return trimmed;
        }
        if (trimmed.length() <= 10) {
            return trimmed;
        }
        return trimmed.substring(0, 6) + "..." + trimmed.substring(trimmed.length() - 4);
    }

    static String maskNonce(String nonce) {
        if (nonce == null || nonce.isBlank()) {
            return "";
        }
        String trimmed = nonce.trim();
        if (trimmed.length() <= 8) {
            return trimmed + "***";
        }
        return trimmed.substring(0, 8) + "***";
    }

    static String textOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        String text = value.asText();
        return text == null || text.isBlank() ? null : text;
    }

    static String textOrThrow(JsonNode node, String field) {
        String value = textOrNull(node, field);
        if (value == null) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "Missing field: " + field, null);
        }
        return value;
    }

    static Integer intOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        return value.asInt();
    }

    static long longOrThrow(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "Missing field: " + field, null);
        }
        return value.asLong();
    }

    static String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first.trim();
        }
        if (second != null && !second.isBlank()) {
            return second.trim();
        }
        return null;
    }

    private static byte[] crc16Xmodem(byte[] data) {
        int crc = 0;
        for (byte b : data) {
            crc ^= (b & 0xFF) << 8;
            for (int i = 0; i < 8; i++) {
                if ((crc & 0x8000) != 0) {
                    crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
                } else {
                    crc = (crc << 1) & 0xFFFF;
                }
            }
        }
        return new byte[]{(byte) ((crc >> 8) & 0xFF), (byte) (crc & 0xFF)};
    }
}
