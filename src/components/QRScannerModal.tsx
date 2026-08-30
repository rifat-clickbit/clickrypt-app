import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';

interface QRScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onScanSuccess: (data: { secret: string; issuer?: string; account?: string }) => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  visible,
  onClose,
  onScanSuccess,
}) => {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (visible && !permission?.granted) {
      requestPermission();
    }
    if (visible) {
      setScanned(false);
    }
  }, [visible]);

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    try {
      // Parse otpauth://totp URI format
      if (data.startsWith('otpauth://')) {
        const url = new URL(data);
        const secret = url.searchParams.get('secret') || '';
        const issuer = url.searchParams.get('issuer') || '';
        const account = decodeURIComponent(url.pathname.replace(/^\/\/totp\//, ''));

        onScanSuccess({ secret, issuer, account });
        onClose();
      } else {
        // Plain text secret key
        onScanSuccess({ secret: data.trim() });
        onClose();
      }
    } catch {
      onScanSuccess({ secret: data.trim() });
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Scan 2FA QR Code</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {!permission?.granted ? (
          <View style={styles.permissionBox}>
            <Text style={styles.permissionText}>
              Camera permission is required to scan 2FA QR codes.
            </Text>
            <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
              <Text style={styles.permBtnText}>Grant Camera Permission</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.cameraContainer}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
            />

            {/* Overlay Viewfinder */}
            <View style={styles.overlayCenter}>
              <View style={styles.viewfinder}>
                <View style={[styles.corner, styles.tl]} />
                <View style={[styles.corner, styles.tr]} />
                <View style={[styles.corner, styles.bl]} />
                <View style={[styles.corner, styles.br]} />
              </View>
              <Text style={styles.hintText}>Align QR code within the frame</Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: colors.surface,
    zIndex: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    color: colors.cyan,
    fontSize: 14,
    fontWeight: '600',
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
  },
  overlayCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  viewfinder: {
    width: 240,
    height: 240,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderColor: colors.cyan,
  },
  tl: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  tr: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  bl: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  br: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  hintText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    gap: 16,
  },
  permissionText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  permBtn: {
    backgroundColor: colors.cyan,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  permBtnText: {
    color: '#062229',
    fontSize: 13.5,
    fontWeight: '700',
  },
});
