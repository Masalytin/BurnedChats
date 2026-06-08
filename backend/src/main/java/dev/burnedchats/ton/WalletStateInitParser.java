package dev.burnedchats.ton;

import dev.burnedchats.exception.WalletProofException;
import org.ton.ton4j.cell.Cell;
import org.ton.ton4j.cell.CellSlice;
import org.ton.ton4j.utils.Utils;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Verifies client-provided {@code walletStateInit} + {@code publicKey} against a parsed wallet address
 * without trusting the client for the public key alone.
 */
@Component
public class WalletStateInitParser {

    /** Wallet v3R2 code hash (see decision log WALLET-401-02). */
    private static final String CODE_HASH_V3R2 =
            "84dafa449f98a6987789ba232358072bc0f76dc4524002a5d0918b9a75d2d599";
    /** Wallet v4R1 code hash. */
    private static final String CODE_HASH_V4R1 =
            "64dd54805522c5be8a9db59ceb0351bdf9d5cd72f8a3a3094c1a3a0d29a7e2c8";
    /** Wallet v4R2 code hash. */
    private static final String CODE_HASH_V4R2 =
            "feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0";
    /** Wallet v5R1 (W5) code hash — current Tonkeeper default. */
    private static final String CODE_HASH_V5 =
            "20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f";

    private static final Map<String, WalletVersion> CODE_HASH_TO_VERSION = Map.of(
            CODE_HASH_V3R2, WalletVersion.V3R2,
            CODE_HASH_V4R1, WalletVersion.V4R1,
            CODE_HASH_V4R2, WalletVersion.V4R2,
            CODE_HASH_V5, WalletVersion.V5);

    public enum WalletVersion {
        V3R2,
        V4R1,
        V4R2,
        V5,
        UNKNOWN
    }

    public record ParsedStateInit(byte[] publicKey, WalletVersion version, byte[] codeHash) {
    }

    /**
     * Parses BoC, checks address hash and public key consistency. Returns empty when wallet code is unknown
     * (caller should fall back to toncenter RPC).
     */
    public Optional<ParsedStateInit> tryParse(
            byte[] stateInitBoc,
            String providedPublicKeyHex,
            byte[] addressHashPart) {
        validateInputs(stateInitBoc, providedPublicKeyHex, addressHashPart);
        Cell stateInit = loadStateInitCell(stateInitBoc);
        assertAddressHash(stateInit, addressHashPart);
        CodeAndData refs = extractCodeAndData(stateInit);
        if (refs == null) {
            return Optional.empty();
        }
        WalletVersion version = resolveVersion(refs.code());
        if (version == WalletVersion.UNKNOWN) {
            return Optional.empty();
        }
        byte[] providedKey = parsePublicKeyHex(providedPublicKeyHex);
        byte[] extractedKey = extractPublicKeyFromData(refs.data(), version);
        if (!Arrays.equals(providedKey, extractedKey)) {
            throw new WalletProofException(
                    WalletProofException.Reason.SIGNATURE_INVALID,
                    "walletPublicKey does not match walletStateInit data",
                    null);
        }
        return Optional.of(new ParsedStateInit(providedKey, version, refs.code().hash()));
    }

    private static void validateInputs(byte[] stateInitBoc, String providedPublicKeyHex, byte[] addressHashPart) {
        if (stateInitBoc == null || stateInitBoc.length == 0) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "walletStateInit is required", null);
        }
        if (providedPublicKeyHex == null || providedPublicKeyHex.isBlank()) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "walletPublicKey is required", null);
        }
        if (addressHashPart == null || addressHashPart.length != 32) {
            throw new WalletProofException(
                    WalletProofException.Reason.ADDRESS_INVALID, "Invalid wallet address hash", null);
        }
    }

    private static Cell loadStateInitCell(byte[] stateInitBoc) {
        try {
            return Cell.fromBoc(stateInitBoc);
        } catch (RuntimeException | Error ex) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "Invalid walletStateInit BoC", ex);
        }
    }

    private static void assertAddressHash(Cell stateInit, byte[] addressHashPart) {
        if (!Arrays.equals(stateInit.hash(), addressHashPart)) {
            throw new WalletProofException(
                    WalletProofException.Reason.SIGNATURE_INVALID,
                    "walletStateInit hash does not match wallet address",
                    null);
        }
    }

    private record CodeAndData(Cell code, Cell data) {
    }

    private static CodeAndData extractCodeAndData(Cell stateInit) {
        Cell code = null;
        Cell data = null;
        CellSlice slice = CellSlice.beginParse(stateInit);
        if (slice.loadBit()) {
            slice.loadUint(5);
        }
        if (slice.loadBit()) {
            slice.loadBit();
            slice.loadBit();
        }
        if (slice.loadBit()) {
            code = slice.loadRef();
        }
        if (slice.loadBit()) {
            data = slice.loadRef();
        }
        if (code == null || data == null) {
            return null;
        }
        return new CodeAndData(code, data);
    }

    private static WalletVersion resolveVersion(Cell code) {
        String codeHashHex = HexFormat.of().formatHex(code.hash()).toLowerCase(Locale.ROOT);
        return CODE_HASH_TO_VERSION.getOrDefault(codeHashHex, WalletVersion.UNKNOWN);
    }

    public ParsedStateInit parse(byte[] stateInitBoc, String providedPublicKeyHex, byte[] addressHashPart) {
        return tryParse(stateInitBoc, providedPublicKeyHex, addressHashPart)
                .orElseThrow(() -> new WalletProofException(
                        WalletProofException.Reason.SIGNATURE_INVALID,
                        "Unsupported wallet contract version",
                        null));
    }

    private static byte[] extractPublicKeyFromData(Cell data, WalletVersion version) {
        CellSlice ds = CellSlice.beginParse(data);
        return switch (version) {
            case V3R2, V4R1, V4R2 -> {
                ds.loadUint(32);
                ds.loadUint(32);
                yield ds.loadBits(256).toByteArray();
            }
            case V5 -> {
                ds.loadBit();
                ds.loadUint(32);
                ds.loadUint(32);
                yield ds.loadBits(256).toByteArray();
            }
            default -> throw new IllegalStateException("Unexpected version: " + version);
        };
    }

    static byte[] parsePublicKeyHex(String value) {
        String hex = value.startsWith("0x") || value.startsWith("0X") ? value.substring(2) : value.trim();
        final byte[] key;
        try {
            key = HexFormat.of().parseHex(hex);
        } catch (IllegalArgumentException ex) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "Invalid walletPublicKey hex", ex);
        }
        if (key.length != 32) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "TON public key must be 32 bytes", null);
        }
        return key;
    }

    static byte[] decodeStateInitBoc(String base64) {
        if (base64 == null || base64.isBlank()) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "walletStateInit is required", null);
        }
        try {
            return Utils.base64ToBytes(base64.trim());
        } catch (RuntimeException ex) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "Invalid walletStateInit BoC", ex);
        }
    }
}
