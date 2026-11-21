package com.banking.fraud.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Stores a list of short strings (rule names) in one TEXT column as "A,B,C" and reads it back.
 * Rule names never contain commas, so this simple format is enough.
 */
@Converter
public class StringListConverter implements AttributeConverter<List<String>, String> {

    private static final String SEPARATOR = ",";

    @Override
    public String convertToDatabaseColumn(List<String> values) {
        return values == null ? "" : String.join(SEPARATOR, values);
    }

    @Override
    public List<String> convertToEntityAttribute(String column) {
        if (column == null || column.isBlank()) {
            return new ArrayList<>();
        }
        return new ArrayList<>(Arrays.stream(column.split(SEPARATOR)).map(String::trim).toList());
    }
}
