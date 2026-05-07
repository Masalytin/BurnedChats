package dev.burnedchats.controller;

import dev.burnedchats.ton.GovernanceVerifier;
import dev.burnedchats.ton.dto.ProposalDetail;
import dev.burnedchats.ton.dto.ProposalSummary;
import dev.burnedchats.ton.dto.UserVote;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Read-only governance cache for the Mini App (backstops {@link GovernanceVerifier} / TON RPC).
 */
@RestController
@RequestMapping("/api/governance")
@RequiredArgsConstructor
public class GovernanceController {

    private final GovernanceVerifier governanceVerifier;

    @GetMapping("/active-proposals")
    public Flux<ProposalSummary> activeProposals() {
        return governanceVerifier.getActiveProposals();
    }

    @GetMapping("/recent-proposals")
    public Flux<ProposalSummary> recentProposals(@RequestParam(name = "limit", defaultValue = "10") int limit) {
        return governanceVerifier.getRecentProposals(limit);
    }

    @GetMapping("/proposals/{id}")
    public Mono<ProposalDetail> proposal(@PathVariable long id) {
        return governanceVerifier.getProposal(id);
    }

    @GetMapping("/proposals/{proposalId}/vote")
    public Mono<ResponseEntity<UserVote>> userVote(
            @PathVariable long proposalId, @RequestParam String address) {
        return governanceVerifier
                .getUserVote(proposalId, address)
                .map(opt -> opt.map(ResponseEntity::ok)
                        .orElseGet(() -> ResponseEntity.notFound().build()));
    }

    @GetMapping("/voting-power")
    public Mono<Map<String, String>> votingPower(@RequestParam String address) {
        return governanceVerifier
                .getUserVotingPower(address)
                .map(vp -> Map.of("votingPower", vp.toString()));
    }
}
