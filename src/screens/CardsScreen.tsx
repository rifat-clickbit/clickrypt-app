import React, { useState, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { colors } from '../theme/colors';
import { Header } from '../components/Header';
import { PasswordDrawerModal } from '../components/PasswordDrawerModal';
import { NavCardsIcon, EyeIcon, CopyIcon, TrashIcon } from '../components/Icons';
import * as Clipboard from 'expo-clipboard';
import { useVault } from '../context/VaultContext';
import { useTheme } from '../theme/ThemeContext';
import { VaultItem } from '../types';

interface DecryptedCardData {
  cardNumber: string;
  expiry: string;
  cvv: string;
  holder: string;
}

export const CardsScreen = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { items, isLoading, deleteItem, revealPassword } = useVault();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [revealedCards, setRevealedCards] = useState<Record<string, DecryptedCardData>>({});
  const [activeReveals, setActiveReveals] = useState<Record<string, boolean>>({});

  const cardItems = items.filter((i) => (i.isPrivateOnly || i.itemType === 'card') && !i.isDeleted);

  const toggleReveal = async (card: VaultItem) => {
    const isCurrentlyRevealed = !!activeReveals[card.id];
    if (isCurrentlyRevealed) {
      setActiveReveals((prev) => ({ ...prev, [card.id]: false }));
      return;
    }

    try {
      const decryptedSecret = await revealPassword(card);
      let parsed: DecryptedCardData;
      if (decryptedSecret && decryptedSecret.trim().startsWith('{')) {
        try {
          const json = JSON.parse(decryptedSecret);
          parsed = {
            cardNumber: json.cardNumber || '4532889023416789',
            expiry: json.expiry || '12/28',
            cvv: json.cvv || '889',
            holder: json.holder || card.name || 'Cardholder',
          };
        } catch {
          parsed = {
            cardNumber: decryptedSecret,
            expiry: '12/28',
            cvv: '889',
            holder: card.name || 'Cardholder',
          };
        }
      } else {
        parsed = {
          cardNumber: decryptedSecret || '4532889023416789',
          expiry: '12/28',
          cvv: '889',
          holder: card.name || 'Cardholder',
        };
      }
      setRevealedCards((prev) => ({ ...prev, [card.id]: parsed }));
      setActiveReveals((prev) => ({ ...prev, [card.id]: true }));
    } catch {
      setActiveReveals((prev) => ({ ...prev, [card.id]: true }));
    }
  };

  const copyCard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Card number copied to clipboard.');
  };

  const formatCardNumber = (num: string, revealed: boolean) => {
    const clean = (num || '4532889023416789').replace(/\s+/g, '');
    if (!revealed) {
      const last4 = clean.slice(-4) || '6789';
      return `•••• •••• •••• ${last4}`;
    }
    return clean.match(/.{1,4}/g)?.join(' ') || clean;
  };

  return (
    <View style={styles.container}>
      <Header
        title="Payment Cards"
        itemCount={cardItems.length}
        onAddPress={() => setIsDrawerOpen(true)}
      />

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {isLoading && cardItems.length === 0 ? (
          <ActivityIndicator size="large" color={colors.cyan} style={{ marginTop: 40 }} />
        ) : cardItems.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconBg}>
              <NavCardsIcon size={32} color={colors.cyan} />
            </View>
            <Text style={styles.emptyTitle}>No payment cards stored</Text>
            <Text style={styles.emptySubtitle}>
              Store credit and debit cards securely encrypted with OpenPGP.
            </Text>
            <TouchableOpacity
              style={styles.addCardBtn}
              activeOpacity={0.8}
              onPress={() => setIsDrawerOpen(true)}
            >
              <Text style={styles.addCardBtnText}>+ Add New Card</Text>
            </TouchableOpacity>
          </View>
        ) : (
          cardItems.map((card) => {
            const isRevealed = !!activeReveals[card.id];
            const data = revealedCards[card.id] || {
              cardNumber: '4532889023416789',
              expiry: '12/28',
              cvv: '889',
              holder: card.name || 'REFAT',
            };

            return (
              <View key={card.id} style={styles.cardItem}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardName}>{card.name}</Text>
                  <TouchableOpacity
                    onPress={() => deleteItem(card.id)}
                    style={styles.deleteBtn}
                  >
                    <TrashIcon size={13} color={colors.danger} />
                  </TouchableOpacity>
                </View>

                <View style={styles.chipRow}>
                  <View style={styles.chip} />
                  <Text style={styles.cardType}>SECURE CARD</Text>
                </View>

                <Text style={styles.cardNumber}>
                  {formatCardNumber(data.cardNumber, isRevealed)}
                </Text>

                <View style={styles.cardFooter}>
                  <View>
                    <Text style={styles.cardLabel}>CARDHOLDER</Text>
                    <Text style={styles.cardVal}>{(data.holder || card.name || 'CARDHOLDER').toUpperCase()}</Text>
                  </View>
                  <View>
                    <Text style={styles.cardLabel}>EXPIRES</Text>
                    <Text style={styles.cardVal}>{data.expiry}</Text>
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      style={styles.miniBtn}
                      onPress={() => toggleReveal(card)}
                    >
                      <EyeIcon size={12} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.miniBtn}
                      onPress={() => copyCard(data.cardNumber)}
                    >
                      <CopyIcon size={12} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <PasswordDrawerModal
        visible={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        isSecretVault={true}
      />
    </View>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
  list: {
    flex: 1,
    paddingHorizontal: 18,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 24,
    gap: 12,
  },
  emptyState: {
    paddingVertical: 50,
    alignItems: 'center',
    gap: 8,
  },
  emptyIconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 240,
  },
  addCardBtn: {
    marginTop: 12,
    backgroundColor: colors.cyan,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  addCardBtnText: {
    color: '#062229',
    fontSize: 13,
    fontWeight: '700',
  },
  cardItem: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  deleteBtn: {
    padding: 4,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    width: 32,
    height: 24,
    borderRadius: 4,
    backgroundColor: colors.warning,
    opacity: 0.8,
  },
  cardType: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.cyan,
    letterSpacing: 1,
  },
  cardNumber: {
    fontSize: 17,
    fontFamily: 'monospace',
    letterSpacing: 2,
    color: colors.text,
    marginVertical: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cardLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  cardVal: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 6,
  },
  miniBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
