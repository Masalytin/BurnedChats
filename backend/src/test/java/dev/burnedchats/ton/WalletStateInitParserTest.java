package dev.burnedchats.ton;

import dev.burnedchats.exception.WalletProofException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.ton.ton4j.cell.Cell;
import org.ton.ton4j.cell.CellBuilder;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DisplayName("WalletStateInitParser")
class WalletStateInitParserTest {

    private static final byte[] PUB_KEY = HexFormat.of().parseHex("11".repeat(32));

    private WalletStateInitParser parser;

    @BeforeEach
    void setUp() {
        parser = new WalletStateInitParser();
    }

    @Test
    @DisplayName("rejects invalid BoC")
    void rejectsInvalidBoc() {
        assertThatThrownBy(() -> parser.tryParse(new byte[] {1, 2, 3}, HexFormat.of().formatHex(PUB_KEY), PUB_KEY))
                .isInstanceOf(WalletProofException.class)
                .satisfies(ex -> assertThat(((WalletProofException) ex).getReason())
                        .isEqualTo(WalletProofException.Reason.INVALID_REQUEST));
    }

    @Test
    @DisplayName("rejects when stateInit hash does not match address")
    void rejectsHashMismatch() {
        byte[] stateInitBoc = buildStateInitWithUnknownCode(PUB_KEY);
        byte[] wrongHash = Arrays.copyOf(PUB_KEY, 32);

        assertThatThrownBy(() -> parser.tryParse(
                        stateInitBoc, HexFormat.of().formatHex(PUB_KEY), wrongHash))
                .isInstanceOf(WalletProofException.class)
                .satisfies(ex -> assertThat(((WalletProofException) ex).getReason())
                        .isEqualTo(WalletProofException.Reason.SIGNATURE_INVALID));
    }

    @Test
    @DisplayName("returns empty for unknown wallet contract code")
    void returnsEmptyForUnknownCode() {
        byte[] stateInitBoc = buildStateInitWithUnknownCode(PUB_KEY);
        Cell stateInit = Cell.fromBoc(stateInitBoc);
        byte[] addressHash = stateInit.hash();

        Optional<WalletStateInitParser.ParsedStateInit> parsed = parser.tryParse(
                stateInitBoc, HexFormat.of().formatHex(PUB_KEY), addressHash);

        assertThat(parsed).isEmpty();
    }

    @Test
    @DisplayName("rejects invalid public key length")
    void rejectsInvalidPublicKeyLength() {
        assertThatThrownBy(() -> WalletStateInitParser.parsePublicKeyHex("abcd"))
                .isInstanceOf(WalletProofException.class)
                .satisfies(ex -> assertThat(((WalletProofException) ex).getReason())
                        .isEqualTo(WalletProofException.Reason.INVALID_REQUEST));
    }

    @Test
    @DisplayName("maps known wallet code hashes for v3R2 and v4 families")
    void knownCodeHashesAreRegistered() {
        assertThat(WalletStateInitParser.WalletVersion.values()).contains(
                WalletStateInitParser.WalletVersion.V3R2,
                WalletStateInitParser.WalletVersion.V4R1,
                WalletStateInitParser.WalletVersion.V4R2,
                WalletStateInitParser.WalletVersion.V5);
    }

    @Test
    @DisplayName("parses a real v4R2 wallet stateInit and extracts the public key")
    void parsesRealV4R2Wallet() {
        assertParsesFixture("v4r2", WalletStateInitParser.WalletVersion.V4R2);
    }

    @Test
    @DisplayName("parses a real v5R1 (W5) wallet stateInit and extracts the public key")
    void parsesRealV5R1Wallet() {
        assertParsesFixture("v5r1", WalletStateInitParser.WalletVersion.V5);
    }

    private void assertParsesFixture(String walletKey, WalletStateInitParser.WalletVersion expected) {
        Properties fixtures = loadFixtures();
        String pubKeyHex = fixtures.getProperty("publicKey");
        byte[] stateInitBoc = Base64.getDecoder().decode(fixtures.getProperty(walletKey + ".stateInitBoc"));
        byte[] addressHash = HexFormat.of().parseHex(fixtures.getProperty(walletKey + ".addressHash"));

        Optional<WalletStateInitParser.ParsedStateInit> parsed =
                parser.tryParse(stateInitBoc, pubKeyHex, addressHash);

        assertThat(parsed).isPresent();
        assertThat(parsed.get().version()).isEqualTo(expected);
        assertThat(HexFormat.of().formatHex(parsed.get().publicKey())).isEqualTo(pubKeyHex);
    }

    private static Properties loadFixtures() {
        Properties props = new Properties();
        try (InputStream in = WalletStateInitParserTest.class.getClassLoader()
                .getResourceAsStream("ton/wallet-state-init-fixtures.properties")) {
            assertThat(in).as("wallet-state-init-fixtures.properties on test classpath").isNotNull();
            props.load(in);
        } catch (IOException ex) {
            throw new IllegalStateException("Failed to load wallet stateInit fixtures", ex);
        }
        return props;
    }

    private static byte[] buildStateInitWithUnknownCode(byte[] publicKey) {
        CellBuilder data = CellBuilder.beginCell().storeUint(0, 32).storeUint(0, 32);
        for (byte b : publicKey) {
            data.storeUint(b & 0xff, 8);
        }
        Cell dataCell = data.endCell();
        Cell code = CellBuilder.beginCell().storeUint(0xDEAD, 32).endCell();
        Cell stateInit = CellBuilder.beginCell()
                .storeBit(false)
                .storeBit(false)
                .storeBit(true)
                .storeRef(code)
                .storeBit(true)
                .storeRef(dataCell)
                .endCell();
        return stateInit.toBoc(false);
    }

}
