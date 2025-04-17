import React, { useRef, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  Animated,
  SafeAreaView,
} from 'react-native';
import {
  createBottomTabNavigator,
  BottomTabBarButtonProps,
} from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { FAB } from '@rneui/themed';
import { useNavigation, CommonActions } from '@react-navigation/native';
// Screens
import HomeScreen from '../screens/home/HomeScreen';
import HistoryScreen from '../screens/history/HistoryScreen';
import AlertsScreen from '../screens/alerts/AlertsScreen';
import NotesScreen from '../screens/notes/NotesScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';

const { width } = Dimensions.get('window');
const scaleFactor = width / 375;
const TAB_BAR_HEIGHT = 65 * scaleFactor;
const ICON_SIZE = 24 * scaleFactor;
const PADDING_HORIZONTAL = 16 * scaleFactor;
const FAB_SIZE = 50 * scaleFactor;

export type TabParamList = {
  Home: undefined;
  History: undefined;
  Alerts: undefined;
  Notes: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

const TabBarButton = ({ children, accessibilityState, onPress }: BottomTabBarButtonProps) => {
  const focused = accessibilityState?.selected || false;
  const animation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(animation, {
      toValue: focused ? 1 : 0,
      tension: 80,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [focused]);

  return (
    <TouchableOpacity style={styles.tabButton} onPress={onPress} activeOpacity={0.7}>
      <Animated.View
        style={[
          styles.tabButtonContainer,
          focused && styles.tabButtonFocused,
          {
            transform: [
              {
                scale: animation.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.1],
                }),
              },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
};

// Props interface for TabNavigator
interface TabNavigatorProps {
  navigation: any;
}

export default function TabNavigator({ navigation: rootNavigation }: TabNavigatorProps) {
  const tabNavigation = useNavigation();
  const fabScale = useRef(new Animated.Value(1)).current;

  const handleStartSensor = () => {
    // Use the root navigation passed as a prop to navigate to StartSensor
    // This ensures we're navigating at the root level, not just within the tab navigator
    rootNavigation.navigate('StartSensor');
  };

  const animateFab = (pressed: boolean) => {
    Animated.spring(fabScale, {
      toValue: pressed ? 0.9 : 1,
      friction: 7,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  return (
    <SafeAreaView style={styles.container}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color }) => {
            let iconName: keyof typeof Ionicons.glyphMap = 'help-circle';
            
            if (route.name === 'Home') {
              iconName = focused ? 'home' : 'home-outline';
            } else if (route.name === 'History') {
              iconName = focused ? 'time' : 'time-outline';
            } else if (route.name === 'Alerts') {
              iconName = focused ? 'alert-circle' : 'alert-circle-outline';
            } else if (route.name === 'Notes') {
              iconName = focused ? 'document-text' : 'document-text-outline';
            } else if (route.name === 'Profile') {
              iconName = focused ? 'person' : 'person-outline';
            }
            
            return <Ionicons name={iconName} size={ICON_SIZE} color={color} />;
          },
          tabBarActiveTintColor: '#4361EE',
          tabBarInactiveTintColor: 'gray',
          headerShown: true,
          tabBarShowLabel: false,
          tabBarButton: (props) => <TabBarButton {...props} />,
          tabBarStyle: styles.tabBar,
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="History" component={HistoryScreen} />
        <Tab.Screen name="Alerts" component={AlertsScreen} />
        <Tab.Screen name="Notes" component={NotesScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>

      <TouchableOpacity
  onPress={handleStartSensor}
  activeOpacity={0.8}
  style={[
    styles.fabContainer,
    { bottom: TAB_BAR_HEIGHT + 5 * scaleFactor },
  ]}
>
  <View style={styles.fabButton}>
    <Ionicons name="add" size={28 * scaleFactor} color="white" />
  </View>
</TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: 'transparent',
  },
  tabBar: {
    position: 'absolute',
    left: PADDING_HORIZONTAL,
    right: PADDING_HORIZONTAL,
    backgroundColor: 'rgba(255, 255, 255, .8)', // translucent white
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    height: TAB_BAR_HEIGHT,
    // shadowColor: '#000',
    // shadowOffset: { width: 0, height: 4 },
    // shadowOpacity: 0.1,
    // shadowRadius: 8,
    elevation: 0,
    justifyContent: 'space-evenly',
    alignItems: 'center',
    flexDirection: 'row',
    zIndex: 10,
    borderTopWidth: 1.5,
    borderRightWidth: 0.5,
    borderLeftWidth: 0.5,
    borderColor: 'rgba(76, 201, 240, 0.45)',
  },
  tabButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  tabButtonContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8 * scaleFactor,
    borderRadius: 20,
    width: 48 * scaleFactor,
    height: 48 * scaleFactor,
    backgroundColor: 'transparent',
  },
  tabButtonFocused: {
    // backgroundColor: 'rgba(67, 97, 238, 0.15)',
  },
  fabContainer: {
    position: 'absolute',
    right: 20,
    zIndex: 20,
  },
  fab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.35,
    shadowRadius: 7,
    elevation: 10,
  },
  fabButton: {
    backgroundColor: '#4361EE',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 12,
    shadowColor: '#4361EE',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(76, 201, 240, 0.45)',
  },
});