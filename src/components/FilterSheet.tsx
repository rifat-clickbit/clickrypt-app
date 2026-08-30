import React, { useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { CheckIcon } from './Icons';
import { FilterMode } from '../context/VaultContext';

interface FilterSheetProps {
  currentFilter: FilterMode;
  onSelect: (filter: FilterMode) => void;
  counts: {
    all: number;
    sharedWithMe: number;
    sharedByMe: number;
    own: number;
    leaked: number;
    outdated: number;
    lastModified: number;
    notes: number;
    trash: number;
  };
  appMode?: 'personal' | 'organization';
}

const FILTER_ITEMS: { key: FilterMode; label: string; orgOnly?: boolean }[] = [
  { key: 'all', label: 'All vault items' },
  { key: 'notes', label: 'Secure Notes' },
  { key: 'sharedWithMe', label: 'Shared with me', orgOnly: true },
  { key: 'sharedByMe', label: 'Shared by me' },
  { key: 'own', label: 'My passwords' },
  { key: 'leaked', label: 'Leaked passwords' },
  { key: 'outdated', label: 'Outdated (>6 months)' },
  { key: 'lastModified', label: 'Recently modified' },
  { key: 'trash', label: 'Trash / Recycle Bin' },
];

export const FilterSheet: React.FC<FilterSheetProps> = ({
  currentFilter,
  onSelect,
  counts,
  appMode = 'personal',
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const visibleItems = FILTER_ITEMS.filter((item) => !item.orgOnly || appMode === 'organization');

  return (
    <View style={styles.container}>
      {visibleItems.map((item, index) => {
        const isSelected = currentFilter === item.key;
        const count = counts[item.key] ?? 0;
        const isLast = index === visibleItems.length - 1;

        return (
          <TouchableOpacity
            key={item.key}
            style={[
              styles.filterOpt,
              isSelected && styles.filterOptSelected,
              !isLast && styles.filterOptBorder,
            ]}
            activeOpacity={0.7}
            onPress={() => onSelect(item.key)}
          >
            <Text style={[styles.optLabel, isSelected && styles.optLabelSelected]}>
              {item.label}
            </Text>

            {isSelected ? (
              <CheckIcon size={14} color={colors.cyan} strokeWidth={2.5} />
            ) : (
              <Text style={styles.countNumber}>{count}</Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      marginHorizontal: 18,
      marginTop: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      overflow: 'hidden',
    },
  filterOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  filterOptSelected: {
    backgroundColor: colors.cyanBg,
  },
  filterOptBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optLabel: {
    fontSize: 13,
    color: colors.text,
    fontWeight: '400',
  },
  optLabelSelected: {
    color: colors.cyan,
    fontWeight: '600',
  },
  countNumber: {
    fontSize: 11.5,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
});
