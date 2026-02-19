package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class SetLanguageRequest {

    @NotBlank
    @Pattern(regexp = "^(en|ru)$", message = "Unsupported language code")
    private String languageCode;
}
