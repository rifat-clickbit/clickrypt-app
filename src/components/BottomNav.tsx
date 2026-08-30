import React, { useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import {
  NavPasswordsIcon,
  NavCardsIcon,
  NavFoldersIcon,
  NavTeamIcon,
  NavSettingsIcon,
} from './Icons';

export type TabType = 'passwords' | 'cards' | 'folders' | 'team' | 'settings';

interface BottomNavProps {
  currentTab: TabType;
  onTabChange: (tab: TabType) => void;
  appMode?: 'personal' | 'organization';
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onTabChange,
  appMode = 'personal',
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const allTabs: {
    key: TabType;
    label: string;
    renderIcon: (active: boolean) => React.ReactNode;
    organizationOnly?: boolean;
  }[] = [
    {
      key: 'passwords',
      label: 'Passwords',
      renderIcon: (active) => (
        <NavPasswordsIcon size={19} color={active ? colors.cyan : colors.textMuted} />
      ),
    },
    {
      key: 'cards',
      label: 'Cards',
      renderIcon: (active) => (
        <NavCardsIcon size={19} color={active ? colors.cyan : colors.textMuted} />
      ),
    },
    {
      key: 'folders',
      label: 'Folders',
      renderIcon: (active) => (
        <NavFoldersIcon size={19} color={active ? colors.cyan : colors.textMuted} />
      ),
    },
    {
      key: 'team',
      label: 'Team',
      organizationOnly: true,
      renderIcon: (active) => (
        <NavTeamIcon size={19} color={active ? colors.cyan : colors.textMuted} />
      ),
    },
    {
      key: 'settings',
      label: 'Settings',
      renderIcon: (active) => (
        <NavSettingsIcon size={19} color={active ? colors.cyan : colors.textMuted} />
      ),
    },
  ];

  // In personal mode, exclude organization-only tabs (Team / Groups)
  const visibleTabs = allTabs.filter((tab) => !tab.organizationOnly || appMode === 'organization');

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bottomNavBg, borderTopColor: colors.border },
      ]}
    >
      {visibleTabs.map((tab) => {
        const isActive = currentTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.navItem}
            activeOpacity={0.7}
            onPress={() => onTabChange(tab.key)}
          >
            {tab.renderIcon(isActive)}
            <Text
              style={[
                styles.navLabel,
                { color: colors.textMuted },
                isActive && [styles.navLabelActive, { color: colors.cyan }],
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      backgroundColor: colors.bottomNavBg,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
      paddingBottom: 22,
      paddingHorizontal: 6,
    },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  navLabel: {
    fontSize: 9.5,
    fontWeight: '500',
    color: colors.textMuted,
  },
  navLabelActive: {
    color: colors.cyan,
    fontWeight: '600',
  },
});
