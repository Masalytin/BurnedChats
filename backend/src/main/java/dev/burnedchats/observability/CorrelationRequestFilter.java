package dev.burnedchats.observability;

import dev.burnedchats.security.AppPrincipal;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.security.Principal;

/**
 * REST correlation: path only (never query string — may contain initData / tokens).
 */
@Component
public class CorrelationRequestFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain) throws ServletException, IOException {
        try {
            CorrelationMdc.putDestination(request.getRequestURI());
            Principal principal = request.getUserPrincipal();
            if (principal instanceof AppPrincipal appPrincipal) {
                CorrelationMdc.putInternalId(appPrincipal.getInternalId());
            }
            filterChain.doFilter(request, response);
        } finally {
            CorrelationMdc.clear();
        }
    }
}
