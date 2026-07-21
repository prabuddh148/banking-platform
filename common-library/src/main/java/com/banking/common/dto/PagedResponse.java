package com.banking.common.dto;

import lombok.Getter;
import lombok.Builder;
import java.util.List;

@Getter
@Builder
public class PagedResponse<T> {

    private final List<T> data;

    private final int page;

    private final int size;

    private final long totalElements;

    private final int totalPages;

    private final boolean last;
}