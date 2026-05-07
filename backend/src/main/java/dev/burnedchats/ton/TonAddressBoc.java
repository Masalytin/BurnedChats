package dev.burnedchats.ton;

import dev.burnedchats.ton.exception.TonRpcException;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.zip.CRC32C;

/**
 * User-friendly / raw TON address parsing and BoC encoding for {@code tvm.Slice} stack args
 * (Ton Center HTTP API v2: {@code ["tvm.Slice", "<base64 BoC>"]}).
 */
public final class TonAddressBoc {

    private static final int BOC_MAGIC = 0xb5ee9c72;
    private static final int BOUNCEABLE_TAG = 0x11;
    private static final int NON_BOUNCEABLE_TAG = 0x51;
    private static final int TEST_FLAG = 0x80;

    private TonAddressBoc() {
    }

    public record ParsedAddress(int workchain, byte[] hash) {
        public ParsedAddress {
            if (hash.length != 32) {
                throw new IllegalArgumentException("hash must be 32 bytes");
            }
        }
    }

    /**
     * Normalizes an address to {@code workchain:hex} for stable Redis keys.
     */
    public static String normalizeKey(String userAddress) {
        ParsedAddress p = parse(userAddress);
        return p.workchain + ":" + HexFormat.of().formatHex(p.hash);
    }

    /**
     * One {@code runGetMethod} stack argument: {@code ["tvm.Slice", base64 BoC]}.
     */
    public static java.util.List<Object> sliceStackArg(String userAddress) {
        String b64 = addressCellToBocBase64(userAddress);
        return java.util.List.of("tvm.Slice", b64);
    }

    /**
     * Stack entry for small non-negative integers ({@code uint} stack values).
     */
    public static java.util.List<Object> numStackArg(long value) {
        if (value < 0) {
            throw new TonRpcException("Negative stack num");
        }
        String hex = Long.toHexString(value);
        return java.util.List.of("num", "0x" + hex);
    }

    public static ParsedAddress parse(String source) {
        String s = source.trim();
        if (s.isEmpty()) {
            throw new TonRpcException("Empty TON address");
        }
        if (isRaw(s)) {
            return parseRaw(s);
        }
        if (isFriendly(s)) {
            return parseFriendly(s);
        }
        throw new TonRpcException("Unknown TON address format: " + source);
    }

    /**
     * Single-root BoC containing one ordinary cell that stores a standard {@code Address} slice
     * (as produced by {@code beginCell().storeAddress(...).endCell()} in {@code @ton/core}).
     */
    public static String addressCellToBocBase64(String userAddress) {
        ParsedAddress p = parse(userAddress);
        int bitLen = 267;
        BitWriter addrBits = new BitWriter();
        addrBits.writeUInt(2, 2);
        addrBits.writeBit(false);
        addrBits.writeInt(p.workchain(), 8);
        for (int i = 0; i < 32; i++) {
            addrBits.writeUInt(p.hash()[i] & 0xff, 8);
        }
        if (addrBits.bitCount() != bitLen) {
            throw new IllegalStateException("Unexpected address bit length");
        }
        byte[] paddedData = addrBits.toPaddedCellBytes();

        int d1 = 0;
        int d2 = bitsDescriptor(bitLen);
        byte[] cellBytes = new byte[2 + paddedData.length];
        cellBytes[0] = (byte) d1;
        cellBytes[1] = (byte) d2;
        System.arraycopy(paddedData, 0, cellBytes, 2, paddedData.length);

        int cellsNum = 1;
        int sizeBytes = Math.max(1, (bitsForUint(cellsNum) + 7) / 8);
        int totalCellSize = cellBytes.length;
        int offsetBytes = Math.max(1, (bitsForUint(totalCellSize) + 7) / 8);

        BitWriter boc = new BitWriter();
        boc.writeUInt(BOC_MAGIC, 32);
        boc.writeBit(false);
        boc.writeBit(true);
        boc.writeBit(false);
        boc.writeUInt(0, 2);
        boc.writeUInt(sizeBytes, 3);
        boc.writeUInt(offsetBytes, 8);
        boc.writeUInt(cellsNum, sizeBytes * 8);
        boc.writeUInt(1, sizeBytes * 8);
        boc.writeUInt(0, sizeBytes * 8);
        boc.writeUInt(totalCellSize, offsetBytes * 8);
        boc.writeUInt(0, sizeBytes * 8);
        for (byte b : cellBytes) {
            boc.writeUInt(b & 0xff, 8);
        }
        byte[] withoutCrc = boc.toByteArray();
        CRC32C crc = new CRC32C();
        crc.update(withoutCrc);
        int c = (int) crc.getValue();
        ByteArrayOutputStream out = new ByteArrayOutputStream(withoutCrc.length + 4);
        out.writeBytes(withoutCrc);
        out.write(c & 0xff);
        out.write((c >>> 8) & 0xff);
        out.write((c >>> 16) & 0xff);
        out.write((c >>> 24) & 0xff);
        return Base64.getEncoder().encodeToString(out.toByteArray());
    }

    /**
     * Reads a {@code workchain:hex} address from a single-root BoC of one cell that stores a standard address
     * (same layout as {@link #addressCellToBocBase64(String)}).
     */
    public static String decodeRawAddressFromSingleRootBoc(String base64Boc) {
        byte[] full = Base64.getDecoder().decode(base64Boc);
        if (full.length < 16) {
            throw new TonRpcException("BoC too short");
        }
        CRC32C crc = new CRC32C();
        crc.update(full, 0, full.length - 4);
        int expected = (full[full.length - 4] & 0xff)
                | ((full[full.length - 3] & 0xff) << 8)
                | ((full[full.length - 2] & 0xff) << 16)
                | ((full[full.length - 1] & 0xff) << 24);
        if ((int) crc.getValue() != expected) {
            throw new TonRpcException("Invalid BoC CRC32C");
        }
        int p = 4;
        int meta = full[p++] & 0xff;
        int sizeBytes = meta & 7;
        if (sizeBytes <= 0) {
            throw new TonRpcException("Invalid BoC sizeBytes");
        }
        int offsetBytes = full[p++] & 0xff;
        int cellsNum = readBeUint(full, p, sizeBytes);
        p += sizeBytes;
        p += sizeBytes;
        p += sizeBytes;
        int totalCellSize = readBeUint(full, p, offsetBytes);
        p += offsetBytes;
        p += sizeBytes;
        if (cellsNum != 1 || totalCellSize <= 0 || full.length < p + totalCellSize + 4) {
            throw new TonRpcException("Invalid BoC layout");
        }
        byte[] cell = Arrays.copyOfRange(full, p, p + totalCellSize);
        int d2 = cell[1] & 0xff;
        byte[] padded = Arrays.copyOfRange(cell, 2, cell.length);
        int bitLen = bitLengthFromPaddedPayload(padded, d2);
        BitReader br = new BitReader(padded, bitLen);
        int tag = br.readUint(2);
        if (tag != 2) {
            throw new TonRpcException("Unexpected address tag bits: " + tag);
        }
        br.readBit();
        int wc = br.readInt(8);
        byte[] hash = new byte[32];
        for (int i = 0; i < 32; i++) {
            hash[i] = (byte) br.readUint(8);
        }
        return wc + ":" + HexFormat.of().formatHex(hash);
    }

    private static int bitLengthFromPaddedPayload(byte[] padded, int d2) {
        if (bitsDescriptor(267) == d2) {
            return 267;
        }
        for (int i = padded.length - 1; i >= 0; i--) {
            int b = padded[i] & 0xff;
            if (b != 0) {
                int lowest = Integer.lowestOneBit(b);
                int trailing = Integer.numberOfTrailingZeros(lowest) + 1;
                return i * 8 + (8 - trailing);
            }
        }
        throw new TonRpcException("Empty cell payload");
    }

    static int bitsDescriptor(int bitLength) {
        return (int) (Math.ceil(bitLength / 8.0) + Math.floor(bitLength / 8.0));
    }

    private static int readBeUint(byte[] full, int offset, int nbytes) {
        int v = 0;
        for (int i = 0; i < nbytes; i++) {
            v = (v << 8) | (full[offset + i] & 0xff);
        }
        return v;
    }

    private static int bitsForUint(int v) {
        if (v < 0) {
            throw new IllegalArgumentException("negative");
        }
        if (v == 0) {
            return 1;
        }
        return 32 - Integer.numberOfLeadingZeros(v);
    }

    private static boolean isFriendly(String s) {
        return s.length() == 48 && s.chars().allMatch(c -> isBase64UrlChar((char) c));
    }

    private static boolean isBase64UrlChar(char c) {
        return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9'
                || c == '-' || c == '_';
    }

    private static boolean isRaw(String s) {
        int colon = s.indexOf(':');
        if (colon <= 0) {
            return false;
        }
        String wc = s.substring(0, colon);
        String hex = s.substring(colon + 1).toLowerCase(Locale.ROOT);
        try {
            int workchain = Integer.parseInt(wc);
            if (hex.length() != 64) {
                return false;
            }
            new BigInteger(hex, 16);
            return workchain >= -128 && workchain <= 127;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private static ParsedAddress parseRaw(String s) {
        int colon = s.indexOf(':');
        int wc = Integer.parseInt(s.substring(0, colon));
        byte[] hash = HexFormat.of().parseHex(s.substring(colon + 1));
        return new ParsedAddress(wc, hash);
    }

    private static ParsedAddress parseFriendly(String s) {
        String b64 = s.replace('-', '+').replace('_', '/');
        byte[] data = Base64.getDecoder().decode(b64);
        if (data.length != 36) {
            throw new TonRpcException("Invalid friendly address payload length");
        }
        byte[] payload = Arrays.copyOfRange(data, 0, 34);
        int crcHi = data[34] & 0xff;
        int crcLo = data[35] & 0xff;
        byte[] crcCalc = crc16(payload);
        if ((crcCalc[0] & 0xff) != crcHi || (crcCalc[1] & 0xff) != crcLo) {
            throw new TonRpcException("Invalid friendly address checksum");
        }
        int tag = payload[0] & 0xff;
        int wcByte = payload[1] & 0xff;
        int workchain;
        if (wcByte == 0xff) {
            workchain = -1;
        } else {
            workchain = wcByte;
        }
        int tagNoTest = tag;
        if ((tag & TEST_FLAG) != 0) {
            tagNoTest = tag ^ TEST_FLAG;
        }
        if (tagNoTest != BOUNCEABLE_TAG && tagNoTest != NON_BOUNCEABLE_TAG) {
            throw new TonRpcException("Unknown address tag");
        }
        byte[] hash = Arrays.copyOfRange(payload, 2, 34);
        return new ParsedAddress(workchain, hash);
    }

    private static byte[] crc16(byte[] data) {
        final int poly = 0x1021;
        int reg = 0;
        byte[] message = Arrays.copyOf(data, data.length + 2);
        for (byte b : message) {
            int mask = 0x80;
            while (mask > 0) {
                reg <<= 1;
                if ((b & mask) != 0) {
                    reg += 1;
                }
                mask >>= 1;
                if (reg > 0xffff) {
                    reg &= 0xffff;
                    reg ^= poly;
                }
            }
        }
        return new byte[]{(byte) (reg / 256), (byte) (reg % 256)};
    }

    private static final class BitWriter {
        private byte[] buf = new byte[64];
        private int bitCount;

        int bitCount() {
            return bitCount;
        }

        void writeBit(boolean bit) {
            int bytesNeeded = (bitCount + 8) / 8;
            if (bytesNeeded > buf.length) {
                buf = Arrays.copyOf(buf, Math.max(buf.length * 2, bytesNeeded));
            }
            if (bit) {
                int bi = bitCount / 8;
                int off = 7 - (bitCount % 8);
                buf[bi] |= (byte) (1 << off);
            }
            bitCount++;
        }

        void writeUInt(long value, int bits) {
            if (bits <= 0 || bits > 63) {
                throw new IllegalArgumentException("bits");
            }
            for (int i = bits - 1; i >= 0; i--) {
                writeBit(((value >>> i) & 1) == 1);
            }
        }

        void writeInt(int value, int bits) {
            writeUInt(value & ((1L << bits) - 1), bits);
        }

        byte[] toByteArray() {
            return Arrays.copyOf(buf, (bitCount + 7) / 8);
        }

        byte[] toPaddedCellBytes() {
            int pad = (int) (Math.ceil(bitCount / 8.0) * 8 - bitCount);
            for (int i = 0; i < pad; i++) {
                writeBit(i == 0);
            }
            return toByteArray();
        }
    }

    private static final class BitReader {
        private final byte[] data;
        private final int bitLen;
        private int pos;

        BitReader(byte[] paddedCellData, int bitLen) {
            this.data = paddedCellData;
            this.bitLen = bitLen;
            this.pos = 0;
        }

        boolean readBit() {
            if (pos >= bitLen) {
                throw new TonRpcException("Unexpected end of address bits");
            }
            int bi = pos / 8;
            int off = 7 - (pos % 8);
            pos++;
            return ((data[bi] >> off) & 1) == 1;
        }

        int readUint(int bits) {
            int v = 0;
            for (int i = 0; i < bits; i++) {
                v = (v << 1) | (readBit() ? 1 : 0);
            }
            return v;
        }

        int readInt(int bits) {
            int v = readUint(bits);
            return v << (32 - bits) >> (32 - bits);
        }
    }
}
